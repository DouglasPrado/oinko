import { rmSync } from 'node:fs';
import { BotStore } from '@oinko/bots/store';
import { BotManager } from '@oinko/bots/manager';
export default async function cleanup() {
  const root = process.env.OINKO_E2E_ROOT;
  if (!root) return;
  const store = new BotStore(root);
  const manager = new BotManager(store);
  try {
    for (const bot of store.list()) await manager.stop(bot.id);
  } finally {
    store.close();
  }
  rmSync(root, { recursive: true, force: true });
}
