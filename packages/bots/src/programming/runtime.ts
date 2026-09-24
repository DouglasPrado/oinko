import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceStore } from '@oinko/workspaces';
import {
  ArtifactStore,
  ChannelCommands,
  OperationRecorder,
  ProgrammingDatabase,
  ProgrammingRunService,
  ProgrammingStore,
  RunNotifier,
  RunQueries,
  SqliteTelemetryRepository,
  TelemetryDeliverer,
  TelemetryJournal,
  UsageLedger,
  purgeJournal,
  type MigrationReport,
  type RunExecutor,
} from '@oinko/agent-runtime/programming';
import { BotStore } from '../store.js';
import { StoreAccess } from './access.js';
import { RunnerReconciler } from './reconciler.js';
import type { RunnerPort } from './run-tools.js';

export interface ProgrammingRuntimeOptions {
  root: string;
  /** Producer name for telemetry: `runtime:<bot>`, `dashboard`, `mcp`... */
  producer: string;
  /** Set only in a bot worker: the bot whose runs this process executes. */
  executeFor?: string;
  executor?: RunExecutor;
  runner?: RunnerPort;
  bots?: BotStore;
  /** Literal secrets to scrub from events and artifacts (API keys, tokens). */
  secrets?: () => readonly string[];
  now?: () => number;
}

function signingKey(root: string): Buffer {
  const path = join(root, '.harness/programming.key');
  if (!existsSync(path)) {
    mkdirSync(join(root, '.harness'), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  chmodSync(path, 0o600);
  return readFileSync(path);
}

/**
 * Opens the shared programming runtime of an installation. The dashboard and
 * MCP open it without an executor (they persist requests and controls); the
 * bot worker opens it with one and executes only its own bot's runs.
 */
export function openProgramming(options: ProgrammingRuntimeOptions) {
  const bots = options.bots ?? new BotStore(options.root);
  const ownsBots = !options.bots;
  const workspaces = new WorkspaceStore(options.root);
  const database = new ProgrammingDatabase(join(options.root, '.harness/programming.db'));
  let migration: MigrationReport;
  try {
    migration = database.open();
  } catch (error) {
    workspaces.close();
    if (ownsBots) bots.close();
    throw error;
  }
  const access = new StoreAccess(bots, workspaces);
  const journal = new TelemetryJournal(database, {
    producer: options.producer,
    capture: (botId) => (botId ? (access.bot(botId)?.telemetry.capture ?? 'full') : 'full'),
    ...(options.secrets && { secrets: options.secrets }),
    ...(options.now && { now: options.now }),
  });
  if (migration.applied.length) {
    journal.record('migration_started', {}, { database: 'programming', from: migration.from });
    journal.record('migration_finished', {}, {
      database: 'programming',
      result: 'succeeded',
      to: migration.to,
      applied: migration.applied.map((item) => item.name),
      backup: migration.backupPath ? 'created' : 'none',
    }, 'succeeded');
  }
  const store = new ProgrammingStore(database, options.now);
  const recorder = new OperationRecorder(store, journal, access, options.now);
  const usage = new UsageLedger(store, journal, options.now);
  const artifacts = new ArtifactStore(store, journal, access, join(options.root, '.harness/programming-artifacts'), {
    signingKey: signingKey(options.root),
    ...(options.now && { now: options.now }),
    ...(options.secrets && { secrets: options.secrets }),
  });
  const telemetryPath = (botId: string) => (bots.has(botId) ? bots.runtime(botId).paths.telemetryDbPath : undefined);
  const deliverer = new TelemetryDeliverer(database, journal, (botId) => {
    if (!botId) return undefined;
    const view = access.bot(botId);
    const path = telemetryPath(botId);
    return view?.telemetry.enabled && path ? new SqliteTelemetryRepository(botId, path) : undefined;
  });
  const notifier = new RunNotifier(journal);
  const service = new ProgrammingRunService({
    store,
    journal,
    access,
    recorder,
    usage,
    artifacts,
    ...(options.executor && { executor: options.executor }),
    ...(options.runner && { reconciler: new RunnerReconciler(options.runner) }),
    serves: (botId) => botId === options.executeFor,
    onCycleFinished: (run, outcome) => {
      const path = telemetryPath(run.botId);
      if (path) usage.collectFromTelemetry(run, path, outcome.traceIds);
      usage.publish(run);
    },
    onRunEvent: (run, event) => void notifier.notify(run, event),
    ...(options.now && { now: options.now }),
  });
  const queries = new RunQueries(store, access, journal, usage);
  const commands = options.executeFor
    ? new ChannelCommands({ botId: options.executeFor, service, queries, access, journal })
    : undefined;
  let maintenance: NodeJS.Timeout | undefined;
  return {
    migration,
    database,
    store,
    journal,
    access,
    recorder,
    usage,
    artifacts,
    deliverer,
    notifier,
    service,
    queries,
    commands,
    bots,
    workspaces,
    /** Worker only: executes queued runs, delivers telemetry and applies retention. */
    startWorker() {
      service.startWorker();
      deliverer.start();
      maintenance = setInterval(() => {
        try {
          artifacts.expire();
          const retention = options.executeFor ? (access.bot(options.executeFor)?.telemetry.retentionDays ?? 30) : 30;
          purgeJournal(store, retention);
        } catch {
          /* retention is best effort; the next pass retries */
        }
      }, 3_600_000);
      maintenance.unref();
    },
    async close() {
      if (maintenance) clearInterval(maintenance);
      deliverer.stop();
      await service.close();
      await deliverer.flush().catch(() => undefined);
      database.close();
      workspaces.close();
      if (ownsBots) bots.close();
    },
  };
}
export type ProgrammingRuntime = ReturnType<typeof openProgramming>;
