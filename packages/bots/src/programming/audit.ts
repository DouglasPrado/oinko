import type { TelemetryJournal } from '@oinko/agent-runtime/programming';
import type { Project } from '@oinko/workspaces/contracts';
import type { BotDefinition } from '../schema.js';

/** Paths of fields that differ, never their values: configuration diffs stay redacted. */
export function changedPaths(before: unknown, after: unknown, prefix = '', depth = 3): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  if (depth === 0 || !isObject(before) || !isObject(after)) return [prefix || '.'];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.flatMap((key) => changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key, depth - 1));
}

export function recordBotConfiguration(
  journal: TelemetryJournal,
  before: BotDefinition | undefined,
  after: BotDefinition,
  actorKind: string,
  revision: number,
): void {
  const fields = changedPaths(before ?? {}, after);
  if (!fields.length) return;
  const correlation = { botId: after.id };
  journal.record('bot_configuration_changed', correlation, { actorKind, fields, revision, created: !before });
  const was = !!before?.programmingPolicy?.enabled;
  const now = !!after.programmingPolicy?.enabled;
  if (was !== now)
    journal.record('capability_changed', correlation, {
      capability: 'programming',
      action: now ? 'enabled' : 'disabled',
      actorKind,
      // Disabling stops new runs; active runs are paused at their next safe point.
      effect: now ? 'new_runs_allowed' : 'new_runs_refused_active_paused',
    });
  const models = (definition?: BotDefinition) => JSON.stringify(definition?.programmingPolicy?.models ?? null) + (definition?.model ?? '');
  if (before && models(before) !== models(after))
    journal.record('model_policy_changed', correlation, {
      actorKind,
      main: after.programmingPolicy?.models.main ?? after.model,
      fast: after.programmingPolicy?.models.fast ?? 'none',
      fallbackAfterMs: after.programmingPolicy?.models.fallbackAfterMs ?? 15_000,
    });
}

export function recordProjectConfiguration(
  journal: TelemetryJournal,
  before: Project | undefined,
  after: Project,
  actorKind: string,
): void {
  const fields = changedPaths(before ?? {}, after);
  if (!fields.length) return;
  journal.record('project_configuration_changed', { projectId: after.id }, {
    actorKind,
    fields,
    created: !before,
    revokedBots: (before?.allowedBotIds ?? []).filter((id) => !after.allowedBotIds.includes(id)),
    grantedBots: after.allowedBotIds.filter((id) => !(before?.allowedBotIds ?? []).includes(id)),
  });
}
