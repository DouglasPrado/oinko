import { fileURLToPath } from 'node:url';
import { BotStore, BotError, importOinkLp, runBotCommand } from '@oinko/bots';

const root = fileURLToPath(new URL('../../../', import.meta.url));
try {
  const store = new BotStore(root);
  let id: string | undefined;
  try {
    id = importOinkLp(store);
  } finally {
    store.close();
  }
  if (!id)
    throw new BotError('Configure o Oink LP na dashboard ou no arquivo .env antes de iniciar.');
  const command = process.argv[2] ?? 'start';
  if (command === 'reload')
    console.log(
      'As configurações agora são administradas na dashboard. Reiniciando para aplicar a versão salva.',
    );
  await runBotCommand(root, [command === 'reload' ? 'restart' : command, id]);
} catch (error) {
  console.error(
    error instanceof BotError
      ? error.message
      : 'Não foi possível iniciar o Oink LP. Confira sua configuração na dashboard.',
  );
  process.exitCode = 1;
}
