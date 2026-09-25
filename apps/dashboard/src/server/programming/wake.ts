import type { BotManager } from '@oinko/bots/manager';

export type WakeResult = 'running' | 'started' | 'failed';

/**
 * A run handed back to the queue only moves while its bot's worker runs:
 * start the worker when it is stopped (it may have died since).
 */
export async function wakeWorker(manager: Pick<BotManager, 'status' | 'start'>, botId: string): Promise<WakeResult> {
  const status = await manager.status(botId).catch(() => undefined);
  if (status?.state === 'running') return 'running';
  try {
    await manager.start(botId);
    return 'started';
  } catch {
    return 'failed';
  }
}

export function wakeNotice(result: WakeResult): string {
  if (result === 'started') return ' O bot estava parado e foi iniciado para continuar o trabalho.';
  if (result === 'failed') return ' O bot está parado e não pôde ser iniciado; inicie-o em Bots para o trabalho continuar.';
  return '';
}
