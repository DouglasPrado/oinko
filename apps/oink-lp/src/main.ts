import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import {
  controlRequest,
  readConnections,
  serviceSocketPath,
  startAgentService,
} from '@oinko/agent-runtime';
import { attachCli, cliChannel } from '@oinko/channel-cli';
import { telegramChannel } from '@oinko/channel-telegram';
import { higgsfieldMcp } from '@oinko/mcp-higgsfield';
import { readConfig } from './config.js';
import { createAgent } from './agent-factory.js';

async function main() {
  const command = process.argv[2] ?? 'start';
  if (command === '--help') {
    console.log(
      'Uso: start | chat | status | reload. start conecta todos os canais e MCPs de connections.json. chat conecta a CLI ao bot já iniciado.',
    );
    return;
  }
  if (!['start', 'chat', 'status', 'reload'].includes(command) || process.argv.length > 3)
    throw new Error('Comando inválido. Use start, chat, status ou reload.');
  const socketPath = serviceSocketPath(
    resolve(process.env.AGENT_DATA_DIR ?? './data', process.env.AGENT_ID ?? 'oink-lp'),
  );
  if (command === 'status' || command === 'reload') {
    console.log(
      JSON.stringify(
        await controlRequest(socketPath, `/${command}`, command === 'reload' ? {} : undefined),
        null,
        2,
      ),
    );
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    if (command === 'chat') {
      await attachCli(
        socketPath,
        process.env.CLI_SESSION_ID ?? 'default',
        controller.signal,
        process.env.CLI_CONNECTION_ID ?? 'local',
      );
      return;
    }
    const config = readConfig(process.env);
    const service = await startAgentService({
      socketPath,
      createHost: () => createAgent(config),
      async loadConnections() {
        const localEnv = await readFile('.env', 'utf8').then(
          parseEnv,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return {};
            throw error;
          },
        );
        const env = { ...process.env, ...localEnv };
        const current = readConfig(env);
        const connections = await readConnections(
          resolve(env.AGENT_CONNECTIONS_FILE ?? 'connections.json'),
          {
            ...env,
            HIGGSFIELD_CREDENTIAL_PATH: current.HIGGSFIELD_CREDENTIAL_PATH,
            HIGGSFIELD_MCP_URL: current.HIGGSFIELD_MCP_URL,
            HIGGSFIELD_TOOLS: current.HIGGSFIELD_TOOLS,
          },
        );
        if (current.HIGGSFIELD === 'off')
          for (const entry of connections.mcps)
            if (entry.type === 'higgsfield') entry.enabled = false;
        return connections;
      },
      channels: { cli: cliChannel, telegram: telegramChannel },
      mcps: { higgsfield: higgsfieldMcp },
    });
    try {
      console.log(
        `${config.AGENT_ID} iniciado. Use chat para conversar, status para consultar ou reload após editar connections.json.`,
      );
      if (!controller.signal.aborted)
        await new Promise<void>((done) =>
          controller.signal.addEventListener('abort', () => done(), { once: true }),
        );
    } finally {
      await service.close();
    }
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
main().catch((error: NodeJS.ErrnoException) => {
  console.error(
    error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
      ? 'Bot indisponível. Execute start primeiro e confira o caminho da configuração.'
      : 'Não foi possível executar o comando. Confira a configuração e se o bot já está rodando.',
  );
  process.exitCode = 1;
});
