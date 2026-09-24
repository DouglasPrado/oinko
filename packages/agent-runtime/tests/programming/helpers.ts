import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import {
  ProgrammingDatabase,
  ProgrammingPolicySchema,
  ProgrammingRunSchema,
  ProgrammingStore,
  TelemetryJournal,
  newRunId,
  resolveEffectivePolicy,
  type AccessPort,
  type BotAccessView,
  type ProgrammingPolicy,
  type ProgrammingRun,
  type ProjectAccessView,
} from '../../src/programming/index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

export function tempRoot(prefix = 'oinko-programming-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

export function botView(
  id: string,
  programming: Partial<ProgrammingPolicy> = {},
  telemetry: Partial<BotAccessView['telemetry']> = {},
): BotAccessView {
  return {
    id,
    model: `model-${id}`,
    revision: 1,
    telemetry: { enabled: true, capture: 'full', retentionDays: 30, ...telemetry },
    programming: ProgrammingPolicySchema.parse({ enabled: true, ...programming }),
  };
}

export function projectView(
  id: string,
  allowedBotIds: string[],
  options: { publishers?: string[]; repositories?: string[]; browser?: boolean } = {},
): ProjectAccessView {
  const repositories = options.repositories ?? ['app'];
  return {
    id,
    revision: 1,
    allowedBotIds,
    repositories: repositories.map((repo) => ({ id: repo })),
    programming: {
      commands: [],
      browser: {
        enabled: options.browser ?? true,
        allowedOrigins: [],
        publicDocs: true,
        credentials: [],
      },
      github: {
        repositories: repositories.map((repositoryId) => ({
          repositoryId,
          owner: 'acme',
          name: repositoryId,
          baseBranch: 'main',
        })),
      },
      publisherBotIds: options.publishers ?? [],
    },
  };
}

export class MutableAccess implements AccessPort {
  readonly bots = new Map<string, BotAccessView>();
  readonly projects = new Map<string, ProjectAccessView>();
  bot(id: string) {
    return this.bots.get(id);
  }
  project(id: string) {
    return this.projects.get(id);
  }
  projectIdsFor(botId: string) {
    return [...this.projects.values()].filter((p) => p.allowedBotIds.includes(botId)).map((p) => p.id);
  }
}

/** Two bots with different policies, two projects with different grants. */
export function twoBotMatrix(): MutableAccess {
  const access = new MutableAccess();
  access.bots.set('alpha', botView('alpha'));
  access.bots.set('beta', botView('beta', { autonomy: 'edit', autoResume: false }));
  access.projects.set('one', projectView('one', ['alpha']));
  access.projects.set('two', projectView('two', ['alpha', 'beta'], { publishers: ['alpha'] }));
  return access;
}

export function openStore(dir = tempRoot(), now: () => number = Date.now) {
  const database = new ProgrammingDatabase(join(dir, 'programming.db'), { now });
  database.open();
  const store = new ProgrammingStore(database, now);
  const journal = new TelemetryJournal(database, { producer: 'test', now });
  return { dir, database, store, journal };
}

export function makeRun(
  access: AccessPort,
  botId: string,
  projectId: string,
  overrides: Partial<ProgrammingRun> = {},
): ProgrammingRun {
  const mode = overrides.request?.mode ?? 'change';
  const now = Date.now();
  return ProgrammingRunSchema.parse({
    id: newRunId(),
    botId,
    projectId,
    taskId: 'task-a',
    repositoryIds: ['app'],
    request: { text: 'Corrigir bug', mode },
    state: 'queued',
    phase: 'queued',
    policySnapshot: resolveEffectivePolicy(access.bot(botId)!, access.project(projectId)!, mode),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}
