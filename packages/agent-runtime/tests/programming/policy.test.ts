import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROGRAMMING_POLICY,
  ProgrammingPolicySchema,
  canAccessRun,
  checkOperation,
  resolveEffectivePolicy,
  type AccessPort,
  type BotAccessView,
  type ProjectAccessView,
} from '../../src/programming/index.js';

function bot(id: string, overrides: Partial<BotAccessView['programming']> = {}): BotAccessView {
  return {
    id,
    model: `model-${id}`,
    revision: 1,
    telemetry: { enabled: true, capture: 'full', retentionDays: 30 },
    programming: ProgrammingPolicySchema.parse({ enabled: true, ...overrides }),
  };
}
function project(id: string, allowed: string[], publishers: string[] = []): ProjectAccessView {
  return {
    id,
    revision: 1,
    allowedBotIds: allowed,
    repositories: [{ id: 'app' }],
    programming: {
      commands: [],
      browser: { enabled: true, allowedOrigins: [], publicDocs: true, credentials: [] },
      github: { repositories: [{ repositoryId: 'app', owner: 'acme', name: 'app', baseBranch: 'main' }] },
      publisherBotIds: publishers,
    },
  };
}
class MutableAccess implements AccessPort {
  bots = new Map<string, BotAccessView>();
  projects = new Map<string, ProjectAccessView>();
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

function matrix() {
  const access = new MutableAccess();
  access.bots.set('alpha', bot('alpha', { models: { main: 'main-a', fast: 'fast-a', fallbackAfterMs: 15_000 } }));
  access.bots.set('beta', bot('beta', { autonomy: 'edit', autoResume: false }));
  access.projects.set('one', project('one', ['alpha']));
  access.projects.set('two', project('two', ['alpha', 'beta'], ['alpha']));
  return access;
}

describe('programming policy', () => {
  it('defaults to disabled: migrating a bot never widens permissions and has no money cap', () => {
    expect(DEFAULT_PROGRAMMING_POLICY.enabled).toBe(false);
    expect(DEFAULT_PROGRAMMING_POLICY.autoResume).toBe(true);
    expect(DEFAULT_PROGRAMMING_POLICY.autonomy).toBe('draft_pr');
    expect(DEFAULT_PROGRAMMING_POLICY.cycle.noProgressLimit).toBe(3);
    expect(DEFAULT_PROGRAMMING_POLICY.models.fallbackAfterMs).toBe(15_000);
    expect(JSON.stringify(DEFAULT_PROGRAMMING_POLICY)).not.toMatch(/cost|usd|budget|spend/i);
    expect(() => ProgrammingPolicySchema.parse({ maxCostUsd: 10 })).toThrow();
  });

  it('resolves different configurations per bot without conditionals on identity', () => {
    const access = matrix();
    const a = resolveEffectivePolicy(access.bot('alpha')!, access.project('two')!, 'change');
    const b = resolveEffectivePolicy(access.bot('beta')!, access.project('two')!, 'change');
    expect(a.policy.models).toEqual({ main: 'main-a', fast: 'fast-a', fallbackAfterMs: 15_000 });
    expect(b.policy.models.main).toBe('model-beta');
    expect(a.policy.allowPublication).toBe(true);
    expect(b.policy.allowPublication).toBe(false);
    expect(b.policy.autoResume).toBe(false);
    expect(a.version).not.toBe(b.version);
    expect(a.version).toBe(
      resolveEffectivePolicy(access.bot('alpha')!, access.project('two')!, 'change').version,
    );
  });

  it('refuses projects the bot is not authorized in and disabled capabilities', () => {
    const access = matrix();
    expect(() => resolveEffectivePolicy(access.bot('beta')!, access.project('one')!, 'change')).toThrow(
      /não autorizado/,
    );
    access.bots.set('gamma', { ...bot('gamma'), programming: DEFAULT_PROGRAMMING_POLICY });
    expect(() => resolveEffectivePolicy(access.bot('gamma')!, access.project('two')!, 'change')).toThrow(
      /não está habilitada/,
    );
  });

  it('keeps the run snapshot on policy edits but applies revocation immediately', () => {
    const access = matrix();
    const snapshot = resolveEffectivePolicy(access.bot('alpha')!, access.project('two')!, 'change');
    const run = { botId: 'alpha', projectId: 'two', policySnapshot: snapshot };
    // A later policy edit (analysis-only) does not silently change the running run.
    access.bots.set('alpha', bot('alpha', { autonomy: 'analysis' }));
    expect(checkOperation(access, run, { class: 'mutate', name: 'workspace.replace' }).allowed).toBe(true);
    // Revoking project access is immediate for every class, reads included.
    access.projects.set('two', project('two', ['beta']));
    for (const operation of ['read', 'mutate', 'publish'] as const)
      expect(checkOperation(access, run, { class: operation, name: 'x' })).toMatchObject({
        allowed: false,
        code: 'permission_denied',
      });
  });

  it('revokes publication immediately even when the snapshot allowed it', () => {
    const access = matrix();
    const snapshot = resolveEffectivePolicy(access.bot('alpha')!, access.project('two')!, 'change');
    const run = { botId: 'alpha', projectId: 'two', policySnapshot: snapshot };
    expect(checkOperation(access, run, { class: 'publish', name: 'publication.push' }).allowed).toBe(true);
    access.projects.set('two', project('two', ['alpha', 'beta'], []));
    expect(checkOperation(access, run, { class: 'publish', name: 'publication.push' }).code).toBe(
      'permission_denied',
    );
  });

  it('never lets analysis runs mutate and requires grants for destructive operations', () => {
    const access = matrix();
    const analysis = resolveEffectivePolicy(access.bot('alpha')!, access.project('two')!, 'analysis');
    const run = { botId: 'alpha', projectId: 'two', policySnapshot: analysis };
    expect(checkOperation(access, run, { class: 'mutate', name: 'workspace.replace' }).code).toBe(
      'analysis_only',
    );
    const change = { ...run, policySnapshot: resolveEffectivePolicy(access.bot('alpha')!, access.project('two')!, 'change') };
    expect(checkOperation(access, change, { class: 'destructive', name: 'merge', target: 'pr/1' }).code).toBe(
      'explicit_authorization_required',
    );
    const grant = { grantedBy: 'operator', operation: 'merge', target: 'pr/1', expiresAt: Date.now() + 60_000 };
    expect(checkOperation(access, change, { class: 'destructive', name: 'merge', target: 'pr/1' }, grant).allowed).toBe(true);
    expect(checkOperation(access, change, { class: 'destructive', name: 'merge', target: 'pr/2' }, grant).allowed).toBe(false);
    expect(checkOperation(access, change, { class: 'destructive', name: 'deploy', target: 'pr/1' }, grant).allowed).toBe(false);
  });

  it('scopes run visibility by identity, project access and conversation', () => {
    const access = matrix();
    const run = { botId: 'alpha', projectId: 'two', conversationId: 'telegram:10' };
    expect(canAccessRun(access, { kind: 'operator', id: 'dashboard' }, run, 'control')).toBe(true);
    expect(canAccessRun(access, { kind: 'bot', botId: 'alpha' }, run, 'view')).toBe(true);
    expect(canAccessRun(access, { kind: 'bot', botId: 'beta' }, run, 'view')).toBe(false);
    const chat = { kind: 'channel' as const, botId: 'alpha', channel: 'telegram', conversationId: '10' };
    expect(canAccessRun(access, chat, run, 'control')).toBe(true);
    expect(canAccessRun(access, { ...chat, conversationId: '11' }, run, 'control')).toBe(false);
    expect(canAccessRun(access, { ...chat, conversationId: '11' }, run, 'view')).toBe(false);
    access.projects.set('two', project('two', ['beta']));
    expect(canAccessRun(access, { kind: 'bot', botId: 'alpha' }, run, 'view')).toBe(false);
  });
});
