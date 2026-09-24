import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { Project, Task, Saved } from '@oinko/workspaces/contracts';
import type { Environment, Job, Preview, Settings } from '../contracts/index.js';
import { runnerHandles } from '../contracts/requests.js';
import type { RunnerCommandInput, RunnerCorrelationValue } from '../contracts/requests.js';

export type { RunnerCommandInput, RunnerCorrelationValue } from '../contracts/requests.js';
export interface RunnerState {
  pid: number;
  projects: Saved<Project>[];
  tasks: Saved<Task>[];
  environments: (Saved<Environment> & { secretNames: string[] })[];
  previews: Saved<Preview>[];
  jobs: Saved<Job>[];
  settings?: Saved<Settings>;
  sandboxes: Record<string, string>;
}
export function environmentSocket(root: string) {
  return join(
    // MCP hosts may strip TMPDIR. Unix clients must agree on one socket for
    // the same root instead of starting competing runners for the same data.
    process.platform === 'win32' ? tmpdir() : '/tmp',
    `oinko-env-${createHash('sha256').update(resolve(root)).digest('hex').slice(0, 20)}.sock`,
  );
}
export function environmentRequest<T>(
  root: string,
  path: string,
  body?: unknown,
  timeoutMs = 30_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const input = body === undefined ? undefined : JSON.stringify(body);
    const call = request(
      {
        socketPath: environmentSocket(root),
        path,
        agent: false,
        method: input ? 'POST' : 'GET',
        headers: input
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(input) }
          : {},
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          text += chunk;
          if (text.length > 2_000_000)
            call.destroy(new Error('Resposta do gerenciador excedeu o limite.'));
        });
        response.once('end', () => {
          try {
            const value = JSON.parse(text);
            if ((response.statusCode ?? 500) >= 400)
              reject(
                Object.assign(new Error(value.error ?? 'Operação recusada pelo gerenciador.'), {
                  ...(typeof value.code === 'string' && { code: value.code }),
                  ...(value.details !== undefined && { details: value.details }),
                }),
              );
            else resolve(value as T);
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    call.once('error', reject);
    call.end(input);
  });
}
/** What a runner says about itself; `actions` is absent in builds before the list existed. */
interface RunnerHealth {
  ready: boolean;
  pid?: number;
  actions?: string[];
}
const starts = new Map<string, Promise<RunnerHealth>>();
async function ensureEnvironmentRunner(root: string, runnerPath?: string): Promise<RunnerHealth> {
  root = resolve(root);
  const existing = starts.get(root);
  if (existing) return existing;
  const startup = (async () => {
    const health = await environmentRequest<RunnerHealth>(
      root,
      '/health',
      undefined,
      1000,
    ).catch(() => undefined);
    if (health?.ready) return health;
    let startupFailure: string | undefined;
    if (!health) {
      const directory = join(root, '.harness/runtime');
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const log = openSync(join(directory, 'runner-process.log'), 'a', 0o600);
      const child = fork(
        runnerPath ??
          fileURLToPath(
            new URL('../../../../apps/environment-runner/dist/main.js', import.meta.url),
          ),
        [],
        {
          detached: true,
          execArgv: [],
          env: { ...process.env, OINKO_ROOT: root },
          stdio: ['ignore', log, log, 'ipc'],
        },
      );
      closeSync(log);
      child.on('error', () => {
        startupFailure = 'Não foi possível iniciar o processo do gerenciador.';
      });
      child.on('exit', (code) => {
        startupFailure = `O gerenciador encerrou durante a inicialização (código ${code}).`;
      });
      child.on('message', () => {
        if (child.connected) child.disconnect();
      });
      child.unref();
    }
    for (let i = 0; i < 240; i++) {
      const status = await environmentRequest<RunnerHealth>(
        root,
        '/health',
        undefined,
        1000,
      ).catch(() => undefined);
      if (status?.ready) return status;
      if (startupFailure && !status)
        throw new Error(
          `${startupFailure} Consulte .harness/runtime/runner-process.log e runner-error.log.`,
        );
      await delay(250);
    }
    throw new Error(
      'O gerenciador de ambientes não iniciou. Confira o build e o arquivo .harness/runtime/runner-error.log.',
    );
  })();
  starts.set(root, startup);
  try {
    return await startup;
  } finally {
    starts.delete(root);
  }
}
/**
 * A runner keeps the code it started with: after an update, the process
 * already listening does not know the new commands until it is restarted.
 * Refused here, before the call, so nothing reaches it.
 */
function runnerOutdated(health: RunnerHealth, action: string) {
  const pid = health.pid ?? null;
  return Object.assign(
    new Error(
      `O gerenciador de ambientes em execução${pid ? ` (pid ${pid})` : ''} é de uma versão anterior e não conhece a operação "${action}". Reinicie o gerenciador para carregar a versão atual: encerre o processo e ele é iniciado de novo na próxima operação.`,
    ),
    { code: 'runner_outdated', details: { action, pid } },
  );
}
export class EnvironmentClient {
  constructor(
    readonly root: string,
    private readonly botId?: string,
    private readonly options: { runnerPath?: string } = {},
  ) {}
  async command<T = unknown>(
    command: RunnerCommandInput,
    options: { correlation?: RunnerCorrelationValue; timeoutMs?: number } = {},
  ): Promise<T> {
    const health = await ensureEnvironmentRunner(this.root, this.options.runnerPath);
    if (!runnerHandles(health.actions, command.action)) throw runnerOutdated(health, command.action);
    return environmentRequest<T>(
      this.root,
      '/command',
      { command, botId: this.botId, ...(options.correlation && { correlation: options.correlation }) },
      options.timeoutMs ??
        (command.action === 'shell' ? ((command.timeoutSeconds ?? 120) + 30) * 1000 : 90_000),
    );
  }
  state() {
    return this.command<RunnerState>({ action: 'state' });
  }
}
