import { BotStore } from './store.js';
import { runBot } from './runner.js';
import { BotError } from './schema.js';
import { crashLine } from './crash-log.js';

const store = new BotStore(process.env.OINKO_ROOT!);
const secrets = () => {
  try {
    return Object.values(store.runtime(process.argv[2]!).secrets).filter((value): value is string => typeof value === 'string');
  } catch {
    return [];
  }
};
// A stray rejection (a channel losing the network, say) must not silently
// take down every conversation and run of the bot: log it and keep serving.
process.on('unhandledRejection', (reason) => console.error(crashLine('unhandledRejection', reason, secrets())));
process.on('uncaughtException', (error) => {
  console.error(crashLine('uncaughtException', error, secrets()));
  process.exit(1);
});
let service: Awaited<ReturnType<typeof runBot>> | undefined;
const stop = () => {
  void service?.close();
};
try {
  service = await runBot(store, process.argv[2]!, () => {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    store.close();
  });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.send?.({ ready: true });
  process.disconnect?.();
} catch (error) {
  process.send?.({
    error:
      error instanceof BotError
        ? error.message
        : 'Não foi possível iniciar o bot. Confira as configurações.',
  });
  store.close();
  process.exitCode = 1;
  if (process.connected) process.disconnect?.();
}
