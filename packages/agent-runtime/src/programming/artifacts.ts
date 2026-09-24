import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  ArtifactSchema,
  type Actor,
  type Artifact,
  type CapturePolicy,
  type ProgrammingRun,
} from './contracts.js';
import { ProgrammingError } from './errors.js';
import { canAccessRun, type AccessPort, type EffectivePolicy } from './policy.js';
import { LIVE_STATES } from './state.js';
import type { ProgrammingStore } from './store/programming-store.js';
import type { TelemetryJournal } from './telemetry/journal.js';
import { redactText } from './telemetry/redaction.js';

const LOCATION = /^[0-9a-f]{2}\/[0-9a-f]{64}$/;
const DAY = 86_400_000;
type Row = Record<string, unknown>;

export interface ArtifactInput {
  type: Artifact['type'];
  content: string | Uint8Array;
  mediaType?: string;
  stepId?: string;
  repositoryId?: string;
  commitSha?: string;
  treeHash?: string;
  /** Authenticated screenshots and similar: never shown to other bots. */
  restricted?: boolean;
  capture?: CapturePolicy;
  ttlMs?: number;
}

export interface ArtifactContent {
  artifact: Artifact;
  content: Buffer;
}

function artifactFromRow(row: Row): Artifact {
  return ArtifactSchema.parse({
    id: row.id,
    runId: row.run_id,
    stepId: row.step_id ?? undefined,
    type: row.type,
    repositoryId: row.repository_id ?? undefined,
    commitSha: row.commit_sha ?? undefined,
    treeHash: row.tree_hash ?? undefined,
    location: row.location,
    contentHash: row.content_hash,
    size: row.size,
    mediaType: row.media_type,
    capturePolicy: row.capture_policy,
    restricted: row.restricted === 1,
    accessScope: { botId: row.bot_id, projectId: row.project_id },
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    expiredAt: row.expired_at ?? undefined,
  });
}

/**
 * Content-addressed evidence store. Text is redacted before it touches disk;
 * capture `none`/`hashed` keep only metadata. Access is re-checked on every
 * read against the current project authorization.
 */
export class ArtifactStore {
  private readonly root: string;
  constructor(
    private readonly store: ProgrammingStore,
    private readonly journal: TelemetryJournal,
    private readonly access: AccessPort,
    root: string,
    private readonly options: { signingKey: Buffer; now?: () => number; secrets?: () => readonly string[] },
  ) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = realpathSync(root);
  }

  private get now() {
    return this.options.now ?? Date.now;
  }

  put(run: ProgrammingRun, input: ArtifactInput): Artifact {
    const policy = run.policySnapshot.policy as Partial<EffectivePolicy>;
    const capture = input.capture ?? policy.telemetry?.capture ?? 'full';
    const retentionDays = policy.telemetry?.retentionDays ?? 30;
    const raw =
      typeof input.content === 'string'
        ? Buffer.from(redactText(input.content, this.options.secrets?.() ?? []), 'utf8')
        : Buffer.from(input.content);
    const hash = createHash('sha256').update(raw).digest('hex');
    const stored = capture === 'full';
    const location = stored ? `${hash.slice(0, 2)}/${hash}` : `-/${capture}`;
    if (stored) {
      const directory = join(this.root, hash.slice(0, 2));
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = join(directory, hash);
      if (!existsSync(file)) {
        writeFileSync(file, raw, { mode: 0o600, flag: 'wx' });
        chmodSync(file, 0o600);
      }
    }
    const artifact = ArtifactSchema.parse({
      id: `art-${randomUUID()}`,
      runId: run.id,
      ...(input.stepId && { stepId: input.stepId }),
      type: input.type,
      ...(input.repositoryId && { repositoryId: input.repositoryId }),
      ...(input.commitSha && { commitSha: input.commitSha }),
      ...(input.treeHash && { treeHash: input.treeHash }),
      location,
      contentHash: `sha256:${hash}`,
      size: raw.length,
      mediaType: input.mediaType ?? 'text/plain',
      capturePolicy: capture,
      restricted: input.restricted ?? false,
      accessScope: { botId: run.botId, projectId: run.projectId },
      createdAt: this.now(),
      expiresAt: this.now() + (input.ttlMs ?? retentionDays * DAY),
    });
    this.store.transaction(() => {
      this.store.database.db
        .prepare(
          `INSERT INTO artifacts (id, run_id, step_id, type, repository_id, commit_sha, tree_hash, location,
             content_hash, size, media_type, capture_policy, restricted, bot_id, project_id, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          artifact.id,
          artifact.runId,
          artifact.stepId ?? null,
          artifact.type,
          artifact.repositoryId ?? null,
          artifact.commitSha ?? null,
          artifact.treeHash ?? null,
          artifact.location,
          artifact.contentHash,
          artifact.size,
          artifact.mediaType,
          artifact.capturePolicy,
          artifact.restricted ? 1 : 0,
          artifact.accessScope.botId,
          artifact.accessScope.projectId,
          artifact.createdAt,
          artifact.expiresAt ?? null,
        );
      this.journal.record(
        'artifact_created',
        this.correlation(run, artifact),
        {
          artifactId: artifact.id,
          type: artifact.type,
          capture,
          mediaType: artifact.mediaType,
          size: artifact.size,
          restricted: artifact.restricted,
        },
        'succeeded',
      );
    });
    return artifact;
  }

  get(id: string): Artifact | undefined {
    const row = this.store.database.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as
      | Row
      | undefined;
    return row ? artifactFromRow(row) : undefined;
  }

  listForRun(runId: string): Artifact[] {
    return (
      this.store.database.db
        .prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, id')
        .all(runId) as Row[]
    ).map(artifactFromRow);
  }

  /** Same error for missing and forbidden: IDs cannot be probed. */
  private authorize(actor: Actor, id: string): { artifact: Artifact; run: ProgrammingRun } {
    const artifact = this.get(id);
    const run = artifact && this.store.getRun(artifact.runId);
    const allowed =
      artifact &&
      run &&
      canAccessRun(this.access, actor, run, 'view') &&
      (!artifact.restricted || actor.kind === 'operator' || actor.botId === artifact.accessScope.botId);
    if (!allowed || !artifact || !run)
      throw new ProgrammingError('not_found', 'Artefato não encontrado.');
    return { artifact, run };
  }

  read(actor: Actor, id: string, via = 'api'): ArtifactContent {
    const { artifact, run } = this.authorize(actor, id);
    const correlation = this.correlation(run, artifact);
    if (artifact.expiredAt !== undefined || !LOCATION.test(artifact.location)) {
      this.journal.record(
        'artifact_accessed',
        correlation,
        { artifactId: id, type: artifact.type, interface: via, result: artifact.expiredAt ? 'expired' : 'not_captured' },
        'failed',
      );
      throw new ProgrammingError(
        'unavailable',
        artifact.expiredAt
          ? 'O artefato expirou pela política de retenção.'
          : `Conteúdo não capturado (política ${artifact.capturePolicy}).`,
        { details: { artifactId: id, expiredAt: artifact.expiredAt, capture: artifact.capturePolicy }, retryable: false },
      );
    }
    const file = join(this.root, ...artifact.location.split('/'));
    const resolved = realpathSync(file);
    const inside = relative(this.root, resolved);
    if (inside.startsWith('..') || inside.startsWith(sep))
      throw new ProgrammingError('not_found', 'Artefato não encontrado.');
    const content = readFileSync(resolved);
    this.journal.record('artifact_accessed', correlation, {
      artifactId: id,
      type: artifact.type,
      interface: via,
      result: 'served',
    });
    return { artifact, content };
  }

  /** Short-lived link that still re-checks access when used. */
  createLink(actor: Actor, id: string, ttlMs = 15 * 60_000): string {
    this.authorize(actor, id);
    const payload = Buffer.from(JSON.stringify({ id, actor, exp: this.now() + ttlMs })).toString('base64url');
    const signature = createHmac('sha256', this.options.signingKey).update(payload).digest('base64url');
    return `${payload}.${signature}`;
  }

  readLink(token: string, via = 'link'): ArtifactContent {
    const [payload, signature] = token.split('.');
    const expected = payload
      ? createHmac('sha256', this.options.signingKey).update(payload).digest()
      : Buffer.alloc(0);
    const given = signature ? Buffer.from(signature, 'base64url') : Buffer.alloc(0);
    if (!payload || given.length !== expected.length || !timingSafeEqual(given, expected))
      throw new ProgrammingError('not_found', 'Artefato não encontrado.');
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      id: string;
      actor: Actor;
      exp: number;
    };
    if (value.exp < this.now())
      throw new ProgrammingError('unavailable', 'O link expirou; gere outro pela dashboard.', { retryable: false });
    return this.read(value.actor, value.id, via);
  }

  /**
   * Expires artifacts past their retention. Evidence of a live run, or of a
   * run with operations still uncertain, is kept until that is resolved.
   */
  expire(): Artifact[] {
    const db = this.store.database.db;
    const due = (
      db
        .prepare('SELECT * FROM artifacts WHERE expired_at IS NULL AND expires_at IS NOT NULL AND expires_at < ?')
        .all(this.now()) as Row[]
    ).map(artifactFromRow);
    const expired: Artifact[] = [];
    for (const artifact of due) {
      const run = this.store.getRun(artifact.runId);
      if (run && LIVE_STATES.includes(run.state)) continue;
      if (run && this.store.listReceipts(run.id, ['intended', 'running', 'uncertain']).length) continue;
      this.store.transaction(() => {
        db.prepare('UPDATE artifacts SET expired_at = ? WHERE id = ?').run(this.now(), artifact.id);
        if (run)
          this.journal.record('artifact_expired', this.correlation(run, artifact), {
            artifactId: artifact.id,
            type: artifact.type,
            reason: 'retention',
          });
      });
      expired.push({ ...artifact, expiredAt: this.now() });
    }
    this.collectOrphans();
    return expired;
  }

  /** Deletes files no longer referenced by an unexpired artifact. */
  collectOrphans(): string[] {
    const db = this.store.database.db;
    const live = new Set(
      (
        db.prepare('SELECT DISTINCT location FROM artifacts WHERE expired_at IS NULL').all() as {
          location: string;
        }[]
      ).map((row) => row.location),
    );
    const removed: string[] = [];
    for (const prefix of readdirSync(this.root)) {
      if (!/^[0-9a-f]{2}$/.test(prefix)) continue;
      for (const name of readdirSync(join(this.root, prefix))) {
        const location = `${prefix}/${name}`;
        if (live.has(location)) continue;
        rmSync(join(this.root, prefix, name), { force: true });
        removed.push(location);
      }
    }
    return removed;
  }

  private correlation(run: ProgrammingRun, artifact: Artifact) {
    return {
      botId: run.botId,
      projectId: run.projectId,
      ...(run.taskId && { taskId: run.taskId }),
      runId: run.id,
      ...(artifact.stepId && { stepId: artifact.stepId }),
      policyVersion: run.policySnapshot.version,
    };
  }
}

/**
 * Removes delivered journal rows past retention, never for runs that are
 * still live or hold uncertain receipts.
 */
export function purgeJournal(store: ProgrammingStore, retentionDays: number, now = Date.now()): number {
  const cutoff = now - retentionDays * DAY;
  const result = store.database.db
    .prepare(
      `DELETE FROM telemetry_outbox WHERE delivered_at IS NOT NULL AND occurred_at < ?
       AND (run_id IS NULL OR run_id NOT IN (
         SELECT id FROM programming_runs WHERE state IN ('queued','running','paused','blocked')
         UNION SELECT run_id FROM operation_receipts WHERE state IN ('intended','running','uncertain')))`,
    )
    .run(cutoff);
  return Number(result.changes);
}
