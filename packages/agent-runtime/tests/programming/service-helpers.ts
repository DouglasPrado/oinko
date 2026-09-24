import { join } from 'node:path';
import {
  OperationRecorder,
  ProgrammingDatabase,
  ProgrammingRunService,
  ProgrammingStore,
  TelemetryJournal,
  UsageLedger,
  readJournal,
  type CycleInput,
  type CycleOutcome,
  type Reconciler,
  type RunExecutor,
} from '../../src/programming/index.js';
import type { MutableAccess } from './helpers.js';

export type CycleScript = (input: CycleInput) => Promise<CycleOutcome> | CycleOutcome;

/** Executor driven by per-cycle functions; the last one repeats. */
export class ScriptedExecutor implements RunExecutor {
  readonly inputs: CycleInput[] = [];
  constructor(private readonly scripts: CycleScript[] | ((input: CycleInput) => CycleScript)) {}
  async runCycle(input: CycleInput): Promise<CycleOutcome> {
    this.inputs.push(input);
    const script = Array.isArray(this.scripts)
      ? (this.scripts[this.inputs.filter((i) => i.run.id === input.run.id).length - 1] ?? this.scripts.at(-1)!)
      : this.scripts(input);
    return script(input);
  }
}

export function openServiceDb(dir: string) {
  const database = new ProgrammingDatabase(join(dir, 'programming.db'));
  database.open();
  const store = new ProgrammingStore(database);
  const journal = new TelemetryJournal(database, { producer: `test-${Math.random()}` });
  return { database, store, journal };
}

export function createService(
  dir: string,
  access: MutableAccess,
  options: {
    executor?: RunExecutor;
    reconciler?: Reconciler;
    ownerId?: string;
    leaseTtlMs?: number;
    serves?: (botId: string) => boolean;
  } = {},
) {
  const { database, store, journal } = openServiceDb(dir);
  const recorder = new OperationRecorder(store, journal, access);
  const usage = new UsageLedger(store, journal);
  const events: { runId: string; type: string; message: string }[] = [];
  const service = new ProgrammingRunService({
    store,
    journal,
    access,
    recorder,
    usage,
    ...options,
    pollMs: 20,
    onRunEvent: (run, event) => events.push({ runId: run.id, ...event }),
  });
  return {
    service,
    store,
    journal,
    database,
    recorder,
    usage,
    events,
    types: (runId: string) => readJournal(database, { runId }).map((event) => event.envelope.type),
    async close() {
      await service.close();
      database.close();
    },
  };
}

export const operator = { kind: 'operator' as const, id: 'dashboard' };

/** Evidence helpers mirroring what the workspace tools record. */
export const edit = (revision: string, repositoryId = 'app') => ({
  kind: 'edit' as const,
  repositoryId,
  paths: ['src/a.ts'],
  revision,
});
export const check = (revision: string, result: 'passed' | 'failed' | 'skipped' | 'timeout' | 'infrastructure', checkKind = 'test', repositoryId = 'app') => ({
  kind: 'check' as const,
  checkKind,
  repositoryId,
  result,
  revision,
  fingerprint: `${checkKind}:${revision}:${result}`,
});

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

export async function until(condition: () => boolean, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
