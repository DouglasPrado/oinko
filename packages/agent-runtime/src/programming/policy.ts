import { createHash } from 'node:crypto';
import type { ProjectProgramming } from '@oinko/workspaces/contracts';
import type { Actor, CapturePolicy, PolicySnapshot, ProgrammingRun, RunMode } from './contracts.js';
import { ProgrammingError } from './errors.js';

export { ProgrammingPolicySchema, DEFAULT_PROGRAMMING_POLICY, type ProgrammingPolicy } from './policy-schema.js';
import type { ProgrammingPolicy } from './policy-schema.js';

/** Current view of a bot. Implementations read the store on every call: never cached. */
export interface BotAccessView {
  id: string;
  model: string;
  programming: ProgrammingPolicy;
  telemetry: { enabled: boolean; capture: CapturePolicy; retentionDays: number };
  revision: number;
}
export interface ProjectAccessView {
  id: string;
  allowedBotIds: readonly string[];
  repositories: readonly { id: string }[];
  programming?: ProjectProgramming;
  revision: number;
}
export interface AccessPort {
  bot(botId: string): BotAccessView | undefined;
  project(projectId: string): ProjectAccessView | undefined;
  /** Projects that currently authorize this bot. */
  projectIdsFor(botId: string): string[];
}

// A type alias (not an interface) so it stays assignable to the JSON snapshot.
export type EffectivePolicy = {
  botId: string;
  projectId: string;
  mode: RunMode;
  autonomy: ProgrammingPolicy['autonomy'];
  allowEdits: boolean;
  allowPublication: boolean;
  allowBrowser: boolean;
  autoResume: boolean;
  cycle: ProgrammingPolicy['cycle'];
  models: { main: string; fast?: string; fallbackAfterMs: number };
  notifications: ProgrammingPolicy['notifications'];
  commands: ProjectProgramming['commands'];
  browser: { allowedOrigins: string[]; publicDocs: boolean; credentials: string[] };
  github: ProjectProgramming['github'];
  telemetry: BotAccessView['telemetry'];
  /** Revisions the snapshot was resolved from. */
  sources: { botRevision: number; projectRevision: number };
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function policyVersion(policy: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(policy)).digest('hex')}`;
}

/**
 * Resolves bot + project + request into the snapshot stored on the run.
 * Later edits to the bot or project do not change this snapshot silently.
 */
export function resolveEffectivePolicy(
  bot: BotAccessView,
  project: ProjectAccessView,
  mode: RunMode,
): PolicySnapshot & { policy: EffectivePolicy } {
  if (!bot.programming.enabled)
    throw new ProgrammingError('capability_disabled', 'Programação não está habilitada neste bot.');
  if (!project.allowedBotIds.includes(bot.id))
    throw new ProgrammingError('permission_denied', 'Bot não autorizado neste projeto.');
  const programming = project.programming;
  const allowEdits = mode === 'change' && bot.programming.autonomy !== 'analysis';
  const allowPublication =
    allowEdits &&
    bot.programming.autonomy === 'draft_pr' &&
    bot.programming.capabilities.publication &&
    !!programming?.publisherBotIds.includes(bot.id) &&
    !!programming.github.repositories.length;
  const policy: EffectivePolicy = {
    botId: bot.id,
    projectId: project.id,
    mode,
    autonomy: bot.programming.autonomy,
    allowEdits,
    allowPublication,
    allowBrowser: bot.programming.capabilities.browser && !!programming?.browser.enabled,
    autoResume: bot.programming.autoResume,
    cycle: bot.programming.cycle,
    models: {
      main: bot.programming.models.main ?? bot.model,
      ...(bot.programming.models.fast !== undefined && { fast: bot.programming.models.fast }),
      fallbackAfterMs: bot.programming.models.fallbackAfterMs,
    },
    notifications: bot.programming.notifications,
    commands: programming?.commands ?? [],
    browser: {
      allowedOrigins: programming?.browser.allowedOrigins ?? [],
      publicDocs: programming?.browser.publicDocs ?? true,
      credentials: programming?.browser.credentials ?? [],
    },
    github: programming?.github ?? { repositories: [] },
    telemetry: bot.telemetry,
    sources: { botRevision: bot.revision, projectRevision: project.revision },
  };
  return { version: policyVersion(policy), policy };
}

export type OperationClass = 'read' | 'mutate' | 'publish' | 'browser' | 'destructive';

/** Grant bound to one specific operation; merge/deploy/destruction are never implied. */
export interface ExplicitAuthorization {
  grantedBy: string;
  operation: string;
  target: string;
  expiresAt: number;
}

export interface PermissionDecision {
  allowed: boolean;
  code?: 'not_found' | 'permission_denied' | 'capability_disabled' | 'analysis_only' | 'explicit_authorization_required';
  reason: string;
}

/**
 * Authorization at the operation, using the *current* bot/project for access
 * (revocation is immediate) and the run snapshot for what the run was allowed
 * to attempt (policy edits do not widen a running run).
 */
export function checkOperation(
  access: AccessPort,
  run: Pick<ProgrammingRun, 'botId' | 'projectId' | 'policySnapshot'>,
  operation: { class: OperationClass; name: string; target?: string },
  grant?: ExplicitAuthorization,
  now = Date.now(),
): PermissionDecision {
  const bot = access.bot(run.botId);
  if (!bot) return { allowed: false, code: 'not_found', reason: 'Bot inexistente.' };
  const project = access.project(run.projectId);
  if (!project || !project.allowedBotIds.includes(run.botId))
    return { allowed: false, code: 'permission_denied', reason: 'Bot sem acesso atual ao projeto.' };
  const snapshot = run.policySnapshot.policy as Partial<EffectivePolicy>;
  if (operation.class === 'read') return { allowed: true, reason: 'Leitura autorizada.' };
  if (!bot.programming.enabled)
    return {
      allowed: false,
      code: 'capability_disabled',
      reason: 'Programação foi desabilitada neste bot.',
    };
  if (operation.class === 'destructive') {
    const valid =
      grant &&
      grant.operation === operation.name &&
      grant.target === (operation.target ?? '') &&
      grant.expiresAt > now;
    return valid
      ? { allowed: true, reason: `Autorizado explicitamente por ${grant.grantedBy}.` }
      : {
          allowed: false,
          code: 'explicit_authorization_required',
          reason: 'Merge, deploy e operações destrutivas exigem autorização explícita desta operação.',
        };
  }
  // The browser never changes the project: analysis runs may use it too.
  if (operation.class === 'browser')
    return snapshot.allowBrowser && bot.programming.capabilities.browser && project.programming?.browser.enabled
      ? { allowed: true, reason: 'Browser autorizado.' }
      : { allowed: false, code: 'permission_denied', reason: 'Browser não autorizado para este run.' };
  if (!snapshot.allowEdits)
    return {
      allowed: false,
      code: 'analysis_only',
      reason: 'Este run é somente de análise e não altera o projeto.',
    };
  if (operation.class === 'publish') {
    const stillPublisher =
      !!project.programming?.publisherBotIds.includes(run.botId) &&
      bot.programming.capabilities.publication;
    if (!snapshot.allowPublication || !stillPublisher)
      return {
        allowed: false,
        code: 'permission_denied',
        reason: 'Publicação não autorizada para este bot neste projeto.',
      };
  }
  return { allowed: true, reason: 'Operação autorizada.' };
}

/**
 * Who may see or control a run. A guessed ID from someone without access gets
 * the same answer as a missing ID.
 */
export function canAccessRun(
  access: AccessPort,
  actor: Actor,
  run: Pick<ProgrammingRun, 'botId' | 'projectId' | 'conversationId'>,
  intent: 'view' | 'control',
): boolean {
  if (actor.kind === 'operator') return true;
  if (actor.botId !== run.botId) return false;
  const project = access.project(run.projectId);
  if (!project || !project.allowedBotIds.includes(run.botId)) return false;
  // A chat only sees and controls work started in that same conversation:
  // another person's chat with the same bot is a different audience.
  if (actor.kind === 'channel') return run.conversationId === channelConversationId(actor);
  void intent;
  return true;
}

/** Conversation identity used by channels; matches the runtime thread route. */
export function channelConversationId(actor: Extract<Actor, { kind: 'channel' }>): string {
  return `${actor.channel}:${actor.conversationId}`;
}
