import { attachCli } from '@oinko/channel-cli';
import { BotStore } from './store.js';
import { BotManager } from './manager.js';
import { BotError } from './schema.js';
import { importOinkLp } from './import-legacy.js';

export async function runBotCommand(root: string, args: string[]) {
  const store = new BotStore(root);
  const manager = new BotManager(store, { workerPath: new URL('./worker.js', import.meta.url) });
  const [command = 'list', id] = args;
  try {
    if (command === 'import-oink-lp') {
      console.log(
        importOinkLp(store)
          ? 'Oink LP disponível no cadastro de bots.'
          : 'Nenhuma configuração anterior encontrada.',
      );
      return;
    }
    if (command === 'list') {
      console.log(JSON.stringify(await manager.list(), null, 2));
      return;
    }
    if (!id || args.length > 2)
      throw new BotError(
        'Uso: pnpm bot list | start <id> | stop <id> | restart <id> | status <id> | chat <id> | import-oink-lp',
      );
    if (command === 'chat') {
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      try {
        await attachCli(
          manager.socket(id),
          process.env.CLI_SESSION_ID || 'default',
          controller.signal,
        );
      } finally {
        process.removeListener('SIGINT', stop);
        process.removeListener('SIGTERM', stop);
      }
      return;
    }
    if (!['start', 'stop', 'restart', 'status'].includes(command))
      throw new BotError('Comando desconhecido. Use start, stop, restart, status ou chat.');
    const action = command as 'start' | 'stop' | 'restart' | 'status';
    console.log(JSON.stringify(await manager[action](id), null, 2));
  } finally {
    store.close();
  }
}
