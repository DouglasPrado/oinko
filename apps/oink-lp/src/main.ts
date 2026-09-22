import { readConfig } from './config.js';
import { createAgent } from './agent-factory.js';
import { runCli } from '@oinko/channel-cli';
import { runTelegram } from '@oinko/channel-telegram';

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Uso: pnpm --filter @oinko/oink-lp dev [cli|telegram|both]\nConfigure apps/oink-lp/.env conforme .env.example.',
    );
    return;
  }
  const config = readConfig(process.env, process.argv.slice(2));
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const app = createAgent(config);
  const tasks: Promise<void>[] = [];
  try {
    await app.ready;
    if (config.mode !== 'cli')
      tasks.push(
        runTelegram(
          { token: config.TELEGRAM_BOT_TOKEN!, allowedUserIds: config.allowedUserIds },
          app.runtime,
          controller.signal,
        ),
      );
    if (config.mode !== 'telegram')
      tasks.push(runCli(app.runtime, config.CLI_SESSION_ID, controller.signal));
    // In both mode, exiting the CLI also closes the Telegram connection.
    await Promise.race(tasks);
  } finally {
    controller.abort();
    await Promise.allSettled(tasks);
    await app.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}

main().catch(() => {
  // Configuration diagnostics name only fields, never secret values.
  try {
    readConfig(process.env, process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Configuração inválida.');
    process.exitCode = 1;
    return;
  }
  console.error(
    'Não foi possível executar o agente. Verifique a configuração, a conexão e se o bot já está em execução.',
  );
  process.exitCode = 1;
});
