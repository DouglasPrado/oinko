#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createOinkoServer } from './index.js';

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      bot: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      'print-config': { type: 'boolean' },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(
      'Oinko MCP (stdio)\nUso: node dist/cli.js [--root /caminho/oinko] [--bot <id>] [--print-config]\nRaiz: --root, OINKO_ROOT ou checkout do servidor. --bot conecta como esse bot, sem ferramentas de administração. Node 22.5+; Docker para sandbox.\n',
    );
    return;
  }
  const root = resolve(
    values.root ??
      process.env.OINKO_ROOT ??
      fileURLToPath(new URL('../../../../', import.meta.url)),
  );
  if (values['print-config']) {
    process.stdout.write(
      JSON.stringify(
        {
          mcpServers: {
            oinko: {
              command: process.execPath,
              args: [fileURLToPath(import.meta.url), '--root', root],
              env: { PATH: process.env.PATH ?? '' },
            },
          },
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }
  const botId = values.bot ?? process.env.OINKO_MCP_BOT;
  const server = createOinkoServer({ root, ...(botId && { botId }) });
  await server.connect(new StdioServerTransport());
  const close = () => {
    void server.close().catch((error: unknown) => console.error(error));
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
  process.stdin.once('end', close);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
