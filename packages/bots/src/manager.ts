import { fork } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { controlRequest, serviceSocketPath } from '@oinko/agent-runtime/control';
import type { ConnectionStatus } from '@oinko/agent-runtime/connections';
import { BotError } from './schema.js';
import type { BotStore } from './store.js';

export interface BotStatus {
  state: 'running' | 'stopped' | 'unavailable';
  revision?: number;
  needsRestart: boolean;
  connections: ConnectionStatus[];
}
export class BotManager {
  constructor(
    readonly store: BotStore,
    private readonly options: { workerPath?: URL } = {},
  ) {}
  socket(id: string): string {
    return serviceSocketPath(this.store.runtime(id).paths.dataDir);
  }
  async status(id: string): Promise<BotStatus> {
    const saved = this.store.get(id);
    try {
      const live = await controlRequest<{
        agentId: string;
        revision?: number;
        connections: ConnectionStatus[];
      }>(this.socket(id), '/status', undefined, AbortSignal.timeout(2000));
      if (live.agentId !== id)
        return { state: 'unavailable', needsRestart: false, connections: [] };
      return {
        state: 'running',
        revision: live.revision,
        needsRestart: live.revision !== saved.revision,
        connections: live.connections,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return {
        state: code === 'ENOENT' || code === 'ECONNREFUSED' ? 'stopped' : 'unavailable',
        needsRestart: false,
        connections: [],
      };
    }
  }
  async list() {
    return Promise.all(
      this.store
        .list()
        .map(async (profile) => ({ ...profile, status: await this.status(profile.id) })),
    );
  }
  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const owner = randomUUID();
    if (!this.store.acquire(owner))
      throw new BotError('Outra operação está em andamento. Aguarde e tente novamente.');
    try {
      return await action();
    } finally {
      this.store.release(owner);
    }
  }
  async start(id: string) {
    return this.exclusive(() => this.startUnlocked(id));
  }
  private async startUnlocked(id: string): Promise<BotStatus> {
    const status = await this.status(id);
    if (status.state === 'running') return status;
    if (status.state === 'unavailable')
      throw new BotError('O bot não respondeu. Aguarde antes de tentar iniciar novamente.');
    const current = this.store.runtime(id);
    if (current.definition.telegram.enabled) {
      for (const other of this.store.list()) {
        if (other.id === id) continue;
        const candidate = this.store.runtime(other.id);
        const otherStatus = await this.status(other.id);
        if (otherStatus.state === 'stopped') continue;
        const live = await controlRequest<{ connectionClaims?: string[] }>(
          this.socket(other.id),
          '/status',
          undefined,
          AbortSignal.timeout(2000),
        ).catch(() => undefined);
        const claim = `telegram:${createHash('sha256')
          .update(current.secrets.telegramToken ?? '')
          .digest('hex')}`;
        const conflict = live?.connectionClaims
          ? live.connectionClaims.includes(claim)
          : candidate.definition.telegram.enabled &&
            candidate.secrets.telegramToken === current.secrets.telegramToken;
        if (conflict)
          throw new BotError(
            `O Telegram já está em uso pelo bot ${other.name}. Pare esse bot ou configure outro token.`,
          );
      }
    }
    await new Promise<void>((resolve, reject) => {
      const child = fork(
        this.options.workerPath ??
          pathToFileURL(join(this.store.root, 'packages/bots/dist/worker.js')),
        [id],
        {
          detached: true,
          env: { ...process.env, OINKO_ROOT: this.store.root },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        },
      );
      const timer = setTimeout(() => {
        child.kill();
        reject(new BotError('O bot demorou para iniciar. Confira as conexões e tente novamente.'));
      }, 90_000);
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.once('error', () =>
        finish(new BotError('Não foi possível abrir o executor dos bots.')),
      );
      child.once('exit', () => {
        finish(new BotError('O executor encerrou antes de iniciar o bot.'));
      });
      child.once('message', (message: { ready?: boolean; error?: string }) => {
        if (message.ready) {
          child.unref();
          finish();
        } else finish(new BotError(message.error ?? 'Falha ao iniciar o bot.'));
      });
    });
    return this.status(id);
  }
  async stop(id: string) {
    return this.exclusive(() => this.stopUnlocked(id));
  }
  private async stopUnlocked(id: string): Promise<BotStatus> {
    const status = await this.status(id);
    if (status.state === 'stopped') return status;
    await controlRequest(this.socket(id), '/stop', {}, AbortSignal.timeout(5000)).catch(() => {
      throw new BotError(
        'Não foi possível parar o bot. Se ele usa o executor antigo, encerre esse processo uma vez para concluir a migração.',
      );
    });
    for (let i = 0; i < 100; i++) {
      const next = await this.status(id);
      if (next.state === 'stopped') return next;
      await delay(100);
    }
    throw new BotError('O bot ainda está encerrando as conexões. Tente novamente em instantes.');
  }
  async restart(id: string) {
    return this.exclusive(async () => {
      await this.stopUnlocked(id);
      return this.startUnlocked(id);
    });
  }
  async message(id: string, sessionId: string, text: string): Promise<string> {
    const response = await controlRequest<{ answer: string }>(this.socket(id), '/message', {
      sessionId,
      text,
    });
    return response.answer;
  }
}
