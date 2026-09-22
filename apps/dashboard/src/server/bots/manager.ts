import 'server-only';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BotManager } from '@oinko/bots/manager';
import { BotStore } from '@oinko/bots/store';
import { importOinkLp } from '@oinko/bots/import-legacy';

const KEY = Symbol.for('@oinko/dashboard/bot-manager');
export function botManager(): BotManager {
  const holder = globalThis as typeof globalThis & { [KEY]?: BotManager };
  if (!holder[KEY]) {
    const store = new BotStore(process.env.OINKO_ROOT || resolve(process.cwd(), '../..'));
    importOinkLp(store);
    holder[KEY] = new BotManager(store, {
      workerPath: pathToFileURL(resolve(process.cwd(), '../../packages/bots/dist/worker.js')),
    });
  }
  return holder[KEY];
}
