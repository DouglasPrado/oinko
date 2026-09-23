import { fileURLToPath } from 'node:url';
import { runBotCommand } from './commands.js';
import { BotError } from './schema.js';

await runBotCommand(
  process.env.OINKO_ROOT || fileURLToPath(new URL('../../../', import.meta.url)),
  process.argv.slice(2),
).catch((error: unknown) => {
  console.error(
    error instanceof BotError
      ? error.message
      : 'Não foi possível executar o comando. Confira o cadastro de bots.',
  );
  process.exitCode = 1;
});
