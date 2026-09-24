export interface ProgrammingMigration {
  version: number;
  name: string;
  /**
   * Additive migrations only create tables, indexes or nullable columns; an
   * older binary can keep using the database. A non-additive migration forces
   * a coordinated restore on binary rollback.
   */
  additive: boolean;
  up: readonly string[];
}

const RUNS = [
  `CREATE TABLE programming_runs (
     id                    TEXT PRIMARY KEY,
     contract_version      INTEGER NOT NULL DEFAULT 1,
     bot_id                TEXT NOT NULL,
     conversation_id       TEXT,
     project_id            TEXT NOT NULL,
     task_id               TEXT,
     repository_ids_json   TEXT NOT NULL DEFAULT '[]',
     request_json          TEXT NOT NULL,
     mode                  TEXT NOT NULL,
     idempotency_key       TEXT,
     request_hash          TEXT,
     state                 TEXT NOT NULL,
     phase                 TEXT NOT NULL,
     plan_revision         INTEGER NOT NULL DEFAULT 0,
     policy_snapshot_json  TEXT NOT NULL,
     policy_version        TEXT NOT NULL,
     revision              INTEGER NOT NULL DEFAULT 0,
     current_step_id       TEXT,
     lease_owner           TEXT,
     lease_expires_at      INTEGER,
     cycle_count           INTEGER NOT NULL DEFAULT 0,
     no_progress_count     INTEGER NOT NULL DEFAULT 0,
     blocked_json          TEXT,
     final_json            TEXT,
     previous_run_id       TEXT,
     created_at            INTEGER NOT NULL,
     updated_at            INTEGER NOT NULL,
     queued_at             INTEGER NOT NULL,
     started_at            INTEGER,
     finished_at           INTEGER
   )`,
  'CREATE UNIQUE INDEX idx_runs_idempotency ON programming_runs(bot_id, idempotency_key) WHERE idempotency_key IS NOT NULL',
  'CREATE INDEX idx_runs_bot_state ON programming_runs(bot_id, state, queued_at)',
  'CREATE INDEX idx_runs_project ON programming_runs(project_id, created_at)',
  'CREATE INDEX idx_runs_task ON programming_runs(project_id, task_id, created_at)',
];

const STEPS = [
  `CREATE TABLE run_steps (
     id                 TEXT PRIMARY KEY,
     run_id             TEXT NOT NULL,
     kind               TEXT NOT NULL,
     status             TEXT NOT NULL,
     attempt            INTEGER NOT NULL DEFAULT 1,
     objective          TEXT NOT NULL,
     input_refs_json    TEXT NOT NULL DEFAULT '[]',
     output_refs_json   TEXT NOT NULL DEFAULT '[]',
     evidence_refs_json TEXT NOT NULL DEFAULT '[]',
     trace_ids_json     TEXT NOT NULL DEFAULT '[]',
     summary            TEXT,
     created_at         INTEGER NOT NULL,
     started_at         INTEGER,
     finished_at        INTEGER
   )`,
  'CREATE INDEX idx_steps_run ON run_steps(run_id, created_at)',
];

const RECEIPTS = [
  `CREATE TABLE operation_receipts (
     operation_id          TEXT PRIMARY KEY,
     run_id                TEXT NOT NULL,
     step_id               TEXT,
     kind                  TEXT NOT NULL,
     idempotency_key       TEXT NOT NULL,
     params_hash           TEXT NOT NULL,
     actor_json            TEXT NOT NULL,
     executor_id           TEXT,
     job_id                TEXT,
     intent_json           TEXT NOT NULL DEFAULT '{}',
     preconditions_json    TEXT NOT NULL DEFAULT '{}',
     state                 TEXT NOT NULL,
     result_ref            TEXT,
     result_json           TEXT,
     error_json            TEXT,
     observed_effects_json TEXT,
     attempt               INTEGER NOT NULL DEFAULT 1,
     attempt_id            TEXT,
     created_at            INTEGER NOT NULL,
     started_at            INTEGER,
     finished_at           INTEGER,
     reconciled_at         INTEGER
   )`,
  'CREATE UNIQUE INDEX idx_receipts_key ON operation_receipts(run_id, idempotency_key)',
  'CREATE INDEX idx_receipts_state ON operation_receipts(state, run_id)',
];

const ARTIFACTS = [
  `CREATE TABLE artifacts (
     id              TEXT PRIMARY KEY,
     run_id          TEXT NOT NULL,
     step_id         TEXT,
     type            TEXT NOT NULL,
     repository_id   TEXT,
     commit_sha      TEXT,
     tree_hash       TEXT,
     location        TEXT NOT NULL,
     content_hash    TEXT NOT NULL,
     size            INTEGER NOT NULL,
     media_type      TEXT NOT NULL,
     capture_policy  TEXT NOT NULL,
     restricted      INTEGER NOT NULL DEFAULT 0,
     bot_id          TEXT NOT NULL,
     project_id      TEXT NOT NULL,
     created_at      INTEGER NOT NULL,
     expires_at      INTEGER,
     expired_at      INTEGER
   )`,
  'CREATE INDEX idx_artifacts_run ON artifacts(run_id, created_at)',
  'CREATE INDEX idx_artifacts_expiry ON artifacts(expires_at) WHERE expired_at IS NULL',
  'CREATE INDEX idx_artifacts_location ON artifacts(location)',
];

const PUBLICATIONS = [
  `CREATE TABLE publications (
     id                        TEXT PRIMARY KEY,
     bot_id                    TEXT NOT NULL,
     project_id                TEXT NOT NULL,
     task_id                   TEXT NOT NULL,
     repository_id             TEXT NOT NULL,
     branch                    TEXT NOT NULL,
     originating_run_id        TEXT NOT NULL,
     contributing_run_ids_json TEXT NOT NULL DEFAULT '[]',
     remote_sha                TEXT,
     pr_number                 INTEGER,
     pr_url                    TEXT,
     pr_state                  TEXT NOT NULL DEFAULT 'unknown',
     check_refs_json           TEXT NOT NULL DEFAULT '[]',
     reconciliation_state      TEXT NOT NULL DEFAULT 'pending',
     created_at                INTEGER NOT NULL,
     updated_at                INTEGER NOT NULL
   )`,
  'CREATE UNIQUE INDEX idx_publications_identity ON publications(bot_id, project_id, task_id, repository_id)',
];

const CONTROL = [
  `CREATE TABLE control_requests (
     id            TEXT PRIMARY KEY,
     run_id        TEXT NOT NULL,
     kind          TEXT NOT NULL,
     status        TEXT NOT NULL,
     actor_json    TEXT NOT NULL,
     payload_json  TEXT NOT NULL DEFAULT '{}',
     response_json TEXT,
     created_at    INTEGER NOT NULL,
     applied_at    INTEGER
   )`,
  'CREATE INDEX idx_control_run ON control_requests(run_id, status, created_at)',
  `CREATE TABLE plan_revisions (
     run_id      TEXT NOT NULL,
     revision    INTEGER NOT NULL,
     plan_json   TEXT NOT NULL,
     objective   TEXT NOT NULL,
     reason      TEXT NOT NULL,
     source      TEXT NOT NULL,
     compatible  INTEGER NOT NULL DEFAULT 1,
     created_at  INTEGER NOT NULL,
     PRIMARY KEY (run_id, revision)
   )`,
  `CREATE TABLE run_criteria (
     run_id             TEXT NOT NULL,
     id                 TEXT NOT NULL,
     description        TEXT NOT NULL,
     kind               TEXT NOT NULL,
     status             TEXT NOT NULL,
     evidence_refs_json TEXT NOT NULL DEFAULT '[]',
     revision           TEXT,
     updated_at         INTEGER NOT NULL,
     PRIMARY KEY (run_id, id)
   )`,
];

const TELEMETRY = [
  // Journal and outbox in one: rows are written in the same transaction as the
  // state they describe, and delivered_at marks what the repository received.
  `CREATE TABLE telemetry_outbox (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id      TEXT NOT NULL UNIQUE,
     producer      TEXT NOT NULL,
     seq           INTEGER NOT NULL,
     type          TEXT NOT NULL,
     bot_id        TEXT,
     project_id    TEXT,
     run_id        TEXT,
     step_id       TEXT,
     operation_id  TEXT,
     occurred_at   INTEGER NOT NULL,
     envelope_json TEXT NOT NULL,
     delivered_at  INTEGER,
     attempts      INTEGER NOT NULL DEFAULT 0
   )`,
  'CREATE UNIQUE INDEX idx_outbox_producer_seq ON telemetry_outbox(producer, seq)',
  'CREATE INDEX idx_outbox_pending ON telemetry_outbox(id) WHERE delivered_at IS NULL',
  'CREATE INDEX idx_outbox_run ON telemetry_outbox(run_id, occurred_at)',
  'CREATE INDEX idx_outbox_type ON telemetry_outbox(type, occurred_at)',
  `CREATE TABLE producer_sequences (producer TEXT PRIMARY KEY, seq INTEGER NOT NULL)`,
];

const USAGE = [
  `CREATE TABLE usage_records (
     call_id         TEXT PRIMARY KEY,
     run_id          TEXT NOT NULL,
     bot_id          TEXT NOT NULL,
     project_id      TEXT NOT NULL,
     role            TEXT NOT NULL,
     model           TEXT NOT NULL,
     policy_version  TEXT,
     input_tokens    INTEGER,
     output_tokens   INTEGER,
     total_tokens    INTEGER,
     cost_usd        REAL,
     cost_status     TEXT NOT NULL,
     aborted         INTEGER NOT NULL DEFAULT 0,
     attempt         INTEGER NOT NULL DEFAULT 1,
     started_at      INTEGER NOT NULL,
     ended_at        INTEGER,
     updated_at      INTEGER NOT NULL
   )`,
  'CREATE INDEX idx_usage_run ON usage_records(run_id)',
  `CREATE TABLE run_intervals (
     span_id     TEXT PRIMARY KEY,
     run_id      TEXT NOT NULL,
     kind        TEXT NOT NULL,
     started_at  INTEGER NOT NULL,
     ended_at    INTEGER
   )`,
  'CREATE INDEX idx_intervals_run ON run_intervals(run_id, kind)',
];

const EVIDENCE = [
  // Observable facts per cycle; progress and acceptance are computed from here.
  `CREATE TABLE run_evidence (
     id            INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id        TEXT NOT NULL,
     step_id       TEXT,
     kind          TEXT NOT NULL,
     fingerprint   TEXT NOT NULL,
     evidence_json TEXT NOT NULL,
     created_at    INTEGER NOT NULL
   )`,
  'CREATE INDEX idx_evidence_run ON run_evidence(run_id, id)',
];

const LEASES = [
  // One writer per worktree across bots: content preconditions still apply.
  `CREATE TABLE worktree_leases (
     project_id     TEXT NOT NULL,
     task_id        TEXT NOT NULL,
     repository_id  TEXT NOT NULL,
     owner_run_id   TEXT NOT NULL,
     expires_at     INTEGER NOT NULL,
     PRIMARY KEY (project_id, task_id, repository_id)
   )`,
];

export const PROGRAMMING_MIGRATIONS: readonly ProgrammingMigration[] = [
  {
    version: 1,
    name: 'programming-runs',
    additive: true,
    up: [
      ...RUNS,
      ...STEPS,
      ...RECEIPTS,
      ...ARTIFACTS,
      ...PUBLICATIONS,
      ...CONTROL,
      ...TELEMETRY,
      ...USAGE,
      ...EVIDENCE,
      ...LEASES,
    ],
  },
];
