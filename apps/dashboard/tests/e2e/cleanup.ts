import { rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { environmentRequest } from '@oinko/environments/client';
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
  const runner = await environmentRequest<{ pid: number }>(root, '/health', undefined, 1000).catch(
    () => undefined,
  );
  if (runner && runner.pid !== process.pid) {
    try {
      process.kill(runner.pid, 'SIGTERM');
    } catch {
      /* already stopped */
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        process.kill(runner.pid, 0);
      } catch {
        break;
      }
      await delay(100);
    }
    try {
      process.kill(runner.pid, 'SIGKILL');
    } catch {
      /* already stopped */
    }
  }
  const prefix = `oinko-${createHash('sha256').update(root).digest('hex').slice(0, 10)}-`;
  const docker = (args: string[]) =>
    execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 });
  for (const [list, remove] of [
    [
      ['ps', '-a', '--format', '{{.Names}}'],
      ['rm', '-f'],
    ],
    [
      ['network', 'ls', '--format', '{{.Name}}'],
      ['network', 'rm'],
    ],
    [
      ['volume', 'ls', '--format', '{{.Name}}'],
      ['volume', 'rm'],
    ],
    [
      ['image', 'ls', '--format', '{{.Repository}}:{{.Tag}}'],
      ['image', 'rm'],
    ],
  ]) {
    let names: string[];
    try {
      names = docker(list!)
        .trim()
        .split('\n')
        .filter((name) => name.startsWith(prefix));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        docker([...remove!, name]);
      } catch {
        /* keep teardown running for the remaining owned resources */
      }
    }
  }
  rmSync(root, { recursive: true, force: true });
}
