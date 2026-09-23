import { BotStore } from './store.js';
import { runBot } from './runner.js';
import { BotError } from './schema.js';

const store = new BotStore(process.env.OINKO_ROOT!);
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
