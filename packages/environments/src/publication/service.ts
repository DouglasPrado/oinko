import { createHash, randomUUID } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { WorkspaceError, type Project, type Saved, type Task } from '@oinko/workspaces';
import type { RunnerCommandValue } from '../contracts/requests.js';
import type { LocalCheckValue } from '../contracts/publication-requests.js';
import type { RunnerContext } from '../runtime/extensions.js';
import { normalizeChecks, type CiCheck } from './checks.js';
import { PublicationError, errorBody, type ErrorBody } from './errors.js';
import { Mirror, remoteEndpoint, type GitEndpoint, type PushOutcome } from './git.js';
import {
  GithubClient,
  InstallationTokens,
  appJwt,
  missingPermissions,
  parsePrivateKey,
  type GithubResponse,
} from './github.js';
import { dockerPublicationSandbox, type SandboxFactory } from './sandbox.js';
import {
  Redactor,
  mergeFindings,
  pathRules,
  scanPatch,
  scanText,
  type SecretFinding,
} from './secrets.js';
import type {
  AppRecord,
  PublicationEvent,
  PublicationRecord,
  PublicationStore,
  Receipt,
} from './store.js';

type Command<A extends string> = Extract<RunnerCommandValue, { action: A }>;
type Json = Record<string, unknown>;
type Payload = PublicationEvent['payload'];

export interface PublicationOptions {
  /** In-sandbox steps and fetch source; production uses the project container. */
  sandbox?: SandboxFactory;
  /** Timeout of each GitHub REST call. */
  requestTimeoutMs?: number;
  now?: () => number;
  fetch?: typeof fetch;
  /** Commit identity for commits created by the runner. */
  identity?: { name: string; email: string };
  /** Create attempts, each preceded by a lookup, before a PR outcome is reported as uncertain. */
  createAttempts?: number;
  /**
   * Fault injection between phases for crash/timeout tests. Only code that
   * constructs the extension can set it; no request can reach it.
   */
  hooks?: { phase?(phase: string): void | Promise<void> };
}

interface Target {
  project: Saved<Project>;
  task: Saved<Task>;
  repositoryId: string;
  owner: string;
  name: string;
  baseBranch: string;
  installationId: number;
  branch: string;
  publicationId: string;
}

interface Review {
  revision: string;
  branch: string;
  baseBranch: string;
  headSha: string;
  commitSha: string;
  created: boolean;
  remote: { branchSha: string | null; baseSha: string | null };
  fastForward: boolean;
  mergeBase: string | null;
  containsBase: boolean;
  commits: number;
  files: { path: string; status: string }[];
  secrets: SecretFinding[];
  blockers: ErrorBody[];
  verdict: 'ready' | 'blocked';
}

interface GithubState {
  revision: number;
  record: AppRecord;
  client: GithubClient;
  tokens: InstallationTokens;
  jwt: () => string;
}

const BLOCKING = new Set([
  'revision_changed',
  'branch_mismatch',
  'branch_moved',
  'checks_stale',
  'secret_detected',
  'remote_conflict',
  'base_not_found',
  'no_changes',
  'review_too_large',
  'integrity_failed',
  'push_rejected',
  'pr_closed',
  'draft_not_supported',
  'branch_not_published',
  'idempotency_conflict',
]);
const ACCESS = new Set([
  'installation_not_found',
  'installation_suspended',
  'insufficient_permissions',
  'repository_not_accessible',
  'permission_denied',
  'github_unauthorized',
  'app_auth_failed',
  'clock_skew',
]);
const REVIEW_LIMIT_BYTES = 50 * 1024 * 1024;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function notFound() {
  return new PublicationError('not_found', 'Tarefa ou projeto não encontrado para este bot.');
}

export class PublicationService {
  readonly redactor = new Redactor();
  private github?: GithubState;
  private readonly identity: { name: string; email: string };
  constructor(
    readonly store: PublicationStore,
    private readonly options: PublicationOptions = {},
  ) {
    this.identity = options.identity ?? { name: 'Oinko', email: 'oinko@localhost' };
  }
  private now() {
    return (this.options.now ?? Date.now)();
  }
  private async hook(phase: string) {
    await this.options.hooks?.phase?.(phase);
  }

  async handle(command: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    try {
      return this.redactor.deep(await this.dispatch(command, context));
    } catch (error) {
      const operationId = 'operationId' in command ? command.operationId : undefined;
      return {
        ok: false,
        error: this.redactor.deep(errorBody(this.normalize(error), operationId)),
      };
    }
  }
  private normalize(error: unknown): unknown {
    if (error instanceof PublicationError) return error;
    if (error instanceof WorkspaceError)
      return new PublicationError('git_failed', error.message, { retryable: true });
    return error;
  }
  private dispatch(command: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    switch (command.action) {
      case 'publicationStatus':
      case 'githubAppStatus':
        return this.status(context, command.action === 'githubAppStatus' && command.verify);
      case 'saveGithubApp':
        return this.saveApp(context, command);
      case 'githubInstallation':
        return this.installation(context, command.projectId);
      case 'reviewPublication':
        return this.reviewCommand(context, command);
      case 'publish':
        return this.publish(context, command);
      case 'ensureDraftPullRequest':
        return this.ensureDraftCommand(context, command);
      case 'reconcilePublication':
        return this.reconcile(context, command);
      case 'inspectChecks':
        return this.inspectChecks(context, command);
      case 'publicationEvents':
        return this.events(context, command);
      default:
        throw new PublicationError(
          'not_found',
          `Ação de publicação desconhecida: ${command.action}`,
        );
    }
  }

  // ---------------------------------------------------------------- telemetry
  private emit(
    context: RunnerContext,
    type: string,
    status: PublicationEvent['status'],
    fields: {
      target?: Target;
      projectId?: string;
      operationId?: string;
      startedAt?: number;
      error?: ErrorBody;
      payload?: Payload;
    } = {},
  ) {
    const correlation = context.correlation ?? {};
    const payload: Payload = {};
    for (const [key, value] of Object.entries(fields.payload ?? {}))
      payload[key] = typeof value === 'string' ? this.redactor.text(value) : value;
    this.store.record({
      type,
      status,
      occurredAt: Date.now(),
      ...(context.botId && { botId: context.botId }),
      ...((fields.target?.project.id ?? fields.projectId) && {
        projectId: fields.target?.project.id ?? fields.projectId,
      }),
      ...(fields.target?.task.id && { taskId: fields.target.task.id }),
      ...(correlation.runId && { runId: correlation.runId }),
      ...(correlation.stepId && { stepId: correlation.stepId }),
      ...((fields.operationId ?? correlation.operationId) && {
        operationId: fields.operationId ?? correlation.operationId,
      }),
      ...(correlation.attemptId && { attemptId: correlation.attemptId }),
      ...(fields.startedAt !== undefined && { durationMs: Date.now() - fields.startedAt }),
      ...(fields.error && {
        error: {
          code: fields.error.code,
          message: this.redactor.text(fields.error.message),
          retryable: fields.error.retryable,
        },
      }),
      payload,
    });
  }

  // ------------------------------------------------------------ configuration
  private app(): GithubState {
    const record = this.store.app();
    if (!record)
      throw new PublicationError(
        'github_app_not_configured',
        'Configure a GitHub App da instância antes de publicar.',
      );
    if (!this.github || this.github.revision !== record.revision) {
      const pem = this.store.privateKeyPem();
      this.redactor.add(pem);
      const { key } = parsePrivateKey(pem);
      const client = new GithubClient(
        record.apiUrl,
        this.options.requestTimeoutMs ?? 30_000,
        () => this.now(),
        this.options.fetch,
      );
      const jwt = () => appJwt(record.appId, key, this.now());
      this.github = {
        revision: record.revision,
        record,
        client,
        jwt,
        tokens: new InstallationTokens(
          client,
          jwt,
          () => this.now(),
          (token) => this.redactor.add(token),
        ),
      };
    }
    return this.github;
  }
  private async status(context: RunnerContext, verify: boolean) {
    const record = this.store.app();
    if (context.botId) return { ok: true, configured: !!record };
    if (!record) return { ok: true, configured: false };
    const keyAvailable = this.store.keyAvailable();
    const result: Json = {
      ok: true,
      configured: true,
      appId: record.appId,
      fingerprint: record.fingerprint,
      apiUrl: record.apiUrl,
      webUrl: record.webUrl,
      gitUrl: record.gitUrl,
      createdAt: record.createdAt,
      rotatedAt: record.rotatedAt,
      keyAvailable,
    };
    if (verify) {
      try {
        const app = this.app();
        const response = await app.client.request<Json>(
          'GET',
          '/app',
          `Bearer ${app.jwt()}`,
          undefined,
          'app',
        );
        result.verified = {
          ok: true,
          slug: response.data.slug ?? null,
          name: response.data.name ?? null,
        };
      } catch (error) {
        const body = errorBody(this.normalize(error));
        result.verified = { ok: false, code: body.code, message: body.message };
      }
    }
    return result;
  }
  private async saveApp(context: RunnerContext, command: Command<'saveGithubApp'>) {
    if (context.botId)
      throw new PublicationError(
        'admin_only',
        'A configuração da GitHub App pertence ao administrador.',
      );
    const { fingerprint } = parsePrivateKey(command.privateKeyPem);
    if (command.gitUrl.startsWith('file:')) {
      const path = resolve(new URL(command.gitUrl).pathname);
      const harness = resolve(context.root, '.harness');
      if (path === harness || path.startsWith(harness + sep))
        throw new PublicationError(
          'permission_denied',
          'O remoto Git não pode ficar dentro de .harness.',
        );
    }
    this.store.saveApp(
      {
        appId: command.appId,
        apiUrl: command.apiUrl,
        webUrl: command.webUrl,
        gitUrl: command.gitUrl,
        fingerprint,
      },
      command.privateKeyPem,
    );
    this.redactor.add(command.privateKeyPem);
    // Rotation: tokens issued with the previous key are dropped.
    this.github?.tokens.invalidate();
    this.github = undefined;
    return this.status(context, false);
  }

  // ------------------------------------------------------------ authorization
  /** Current access, read fresh on every call so revocation is immediate. */
  private target(context: RunnerContext, taskId: string, repositoryId: string): Target {
    const botId = context.botId;
    if (!botId)
      throw new PublicationError(
        'publisher_required',
        'Publicar exige um bot publicador do projeto; o administrador só consulta status e instalação.',
      );
    let task: Saved<Task>;
    let project: Saved<Project>;
    try {
      task = context.workspaces.task(taskId);
      project = context.workspaces.project(task.projectId);
    } catch {
      throw notFound();
    }
    // Same answer as a missing task: a guessed ID reveals nothing.
    if (!project.allowedBotIds.includes(botId)) throw notFound();
    if (!project.programming?.publisherBotIds.includes(botId))
      throw new PublicationError(
        'publisher_required',
        'Este bot não está autorizado a publicar neste projeto.',
      );
    if (task.state !== 'ready')
      throw new PublicationError('task_not_ready', 'A tarefa ainda não está pronta.');
    if (!project.repositories.some((repository) => repository.id === repositoryId))
      throw new PublicationError('not_found', 'Repositório não pertence ao projeto.');
    const link = project.programming.github.repositories.find(
      (repository) => repository.repositoryId === repositoryId,
    );
    if (!link)
      throw new PublicationError(
        'repository_not_linked',
        'Este repositório não está vinculado a um repositório GitHub do projeto.',
      );
    const installationId = project.programming.github.installationId;
    if (!installationId)
      throw new PublicationError(
        'installation_not_configured',
        'Selecione a instalação da GitHub App do projeto.',
      );
    return {
      project,
      task,
      repositoryId,
      owner: link.owner,
      name: link.name,
      baseBranch: link.baseBranch,
      installationId,
      branch: task.branch,
      publicationId: `${project.id}/${task.id}/${repositoryId}`,
    };
  }
  private async token(context: RunnerContext, target: Target) {
    const app = this.app();
    try {
      const { token, fresh } = await app.tokens.token(
        target.installationId,
        target.owner,
        target.name,
      );
      if (fresh)
        this.emit(context, 'github_token_issued', 'succeeded', {
          target,
          payload: { installationId: target.installationId, repository: target.repositoryId },
        });
      return token;
    } catch (error) {
      if (error instanceof PublicationError && ACCESS.has(error.code))
        this.emit(context, 'github_permission_denied', 'denied', {
          target,
          error: errorBody(error),
          payload: {
            installationId: target.installationId,
            repository: target.repositoryId,
            code: error.code,
          },
        });
      throw error;
    }
  }
  private async remote(context: RunnerContext, target: Target): Promise<GitEndpoint> {
    const app = this.app();
    // The installation must grant access to this repository before any Git
    // operation, also for a local `file://` remote (tests), which only omits
    // the header.
    const token = await this.token(context, target);
    return remoteEndpoint(app.record.gitUrl, target.owner, target.name, token);
  }
  /** REST call scoped to the target repository, retrying once with a fresh token on 401. */
  private async api<T = Json>(
    context: RunnerContext,
    target: Target,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<GithubResponse<T>> {
    const app = this.app();
    const call = async () =>
      app.client.request<T>(
        method,
        `/repos/${target.owner}/${target.name}${path}`,
        `Bearer ${await this.token(context, target)}`,
        body,
      );
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof PublicationError) || error.code !== 'github_unauthorized') throw error;
      app.tokens.invalidate(target.installationId, target.owner, target.name);
      return call();
    }
  }
  private knownSecrets(context: RunnerContext) {
    const values: string[] = [];
    for (const environment of context.environments.environments())
      values.push(...Object.values(context.environments.secrets(environment.id)));
    return [...values, ...this.redactor.known()].filter((value) => value.length >= 8);
  }

  // ---------------------------------------------------------- receipts/journal
  private begin(
    context: RunnerContext,
    target: Target,
    action: string,
    operationId: string,
    params: unknown,
  ): { receipt: Receipt; existing: boolean } {
    const key = `${action}:${target.project.id}:${operationId}`;
    const paramsHash = sha256(JSON.stringify(params));
    const existing = this.store.receipt(key);
    if (existing) {
      if (
        existing.paramsHash !== paramsHash ||
        existing.botId !== context.botId ||
        existing.taskId !== target.task.id ||
        existing.repositoryId !== target.repositoryId
      )
        throw new PublicationError(
          'idempotency_conflict',
          'Este operationId já foi usado com outros parâmetros ou por outro ator.',
        );
      return { receipt: { ...existing, attempt: existing.attempt + 1 }, existing: true };
    }
    const now = Date.now();
    const receipt: Receipt = {
      key,
      action,
      operationId,
      botId: context.botId!,
      projectId: target.project.id,
      taskId: target.task.id,
      repositoryId: target.repositoryId,
      paramsHash,
      state: 'intended',
      phase: 'intended',
      attempt: 1,
      createdAt: now,
      updatedAt: now,
      data: {},
      ...(context.correlation?.runId && { runId: context.correlation.runId }),
    };
    // Intent is durable before any effect; failing here prevents the effect.
    this.store.saveReceipt(receipt);
    this.emit(context, 'operation_intended', 'started', {
      target,
      operationId,
      payload: { kind: action, state: 'intended' },
    });
    return { receipt, existing: false };
  }
  private save(receipt: Receipt, patch: Partial<Receipt>) {
    Object.assign(receipt, patch);
    this.store.saveReceipt(receipt);
  }
  /** Records a failure: uncertain when a remote effect may have happened. */
  private fail(
    context: RunnerContext,
    target: Target,
    receipt: Receipt,
    error: unknown,
    uncertainPhases: string[],
  ) {
    const normalized = this.normalize(error);
    const body = this.redactor.deep(errorBody(normalized, receipt.operationId));
    const uncertain =
      (normalized instanceof PublicationError && normalized.uncertain) ||
      (uncertainPhases.includes(receipt.phase) &&
        !BLOCKING.has(body.code) &&
        !ACCESS.has(body.code));
    if (uncertain) {
      this.save(receipt, { state: 'uncertain', error: body });
      this.emit(context, 'operation_uncertain', 'uncertain', {
        target,
        operationId: receipt.operationId,
        error: body,
        payload: { kind: receipt.action, state: 'uncertain', code: body.code },
      });
      return new PublicationError(
        'operation_uncertain',
        'O resultado no GitHub ficou incerto. Repita com o mesmo operationId para reconciliar; nada será duplicado.',
        { retryable: true, details: { cause: body.code, phase: receipt.phase } },
      );
    }
    this.save(receipt, { state: 'failed', error: body });
    if (BLOCKING.has(body.code))
      this.emit(context, 'publication_blocked', 'denied', {
        target,
        operationId: receipt.operationId,
        error: body,
        payload: { repositoryId: target.repositoryId, code: body.code },
      });
    return normalized;
  }
  private tempRef(key: string) {
    return `refs/oinko/publish/${sha256(key).slice(0, 24)}`;
  }

  // ------------------------------------------------------------- installation
  private async installation(context: RunnerContext, projectId: string) {
    let project: Saved<Project>;
    try {
      project = context.workspaces.project(projectId);
    } catch {
      throw notFound();
    }
    if (context.botId) {
      if (!project.allowedBotIds.includes(context.botId)) throw notFound();
      if (!project.programming?.publisherBotIds.includes(context.botId))
        throw new PublicationError(
          'publisher_required',
          'Este bot não está autorizado a publicar neste projeto.',
        );
    }
    const app = this.app();
    const installationId = project.programming?.github.installationId;
    const links = project.programming?.github.repositories ?? [];
    const repositories = links.map((link) => ({
      repositoryId: link.repositoryId,
      owner: link.owner,
      name: link.name,
      baseBranch: link.baseBranch,
      access: 'unknown' as 'valid' | 'denied' | 'unknown',
      code: undefined as string | undefined,
      message: undefined as string | undefined,
    }));
    const finish = (status: string, extra: Json = {}) => {
      this.emit(
        context,
        'github_installation_checked',
        status === 'ready' ? 'succeeded' : 'failed',
        {
          projectId,
          payload: { installationId: installationId ?? null, result: status },
        },
      );
      return {
        ok: true,
        projectId,
        installationId: installationId ?? null,
        status,
        ready: status === 'ready',
        repositories: repositories.map((repository) =>
          Object.fromEntries(Object.entries(repository).filter(([, value]) => value !== undefined)),
        ),
        ...extra,
      };
    };
    if (!installationId) return finish('installation_not_configured', { installed: false });
    let installation: Json;
    try {
      installation = (
        await app.client.request<Json>(
          'GET',
          `/app/installations/${installationId}`,
          `Bearer ${app.jwt()}`,
          undefined,
          'app',
        )
      ).data;
    } catch (error) {
      const body = errorBody(this.normalize(error));
      const status = body.code === 'not_found' ? 'installation_not_found' : body.code;
      return finish(status, {
        installed: status === 'installation_not_found' ? false : null,
        error: { ...body, code: status },
      });
    }
    const account = (installation.account ?? {}) as Json;
    const granted = (installation.permissions ?? {}) as Record<string, string>;
    const missing = missingPermissions(granted);
    const details = {
      installed: true,
      installation: {
        account: account.login ?? null,
        accountType: account.type ?? null,
        repositorySelection: installation.repository_selection ?? null,
        suspended: !!installation.suspended_at,
        permissions: granted,
        missingPermissions: missing,
      },
    };
    if (installation.suspended_at) return finish('installation_suspended', details);
    if (missing.length) return finish('insufficient_permissions', details);
    for (const repository of repositories) {
      const target = {
        project,
        task: { id: '' } as Saved<Task>,
        repositoryId: repository.repositoryId,
        owner: repository.owner,
        name: repository.name,
        baseBranch: repository.baseBranch,
        installationId,
        branch: '',
        publicationId: '',
      };
      try {
        if (String(account.login ?? '').toLowerCase() !== repository.owner.toLowerCase())
          throw new PublicationError(
            'repository_not_accessible',
            `A instalação pertence a ${String(account.login)}, não a ${repository.owner}.`,
            { details: { reason: 'account_mismatch' } },
          );
        await this.api(context, target, 'GET', '');
        repository.access = 'valid';
      } catch (error) {
        const body = errorBody(this.normalize(error));
        const code = body.code === 'not_found' ? 'repository_not_accessible' : body.code;
        repository.access = 'denied';
        repository.code = code;
        repository.message = body.message;
        if (!ACCESS.has(code)) repository.access = 'unknown';
        // Token issuance already reported its own denials.
        else if (body.code === 'not_found' || body.details?.reason === 'account_mismatch')
          this.emit(context, 'github_permission_denied', 'denied', {
            projectId,
            payload: { installationId, repository: repository.repositoryId, code },
          });
      }
    }
    const denied = repositories.some((repository) => repository.access !== 'valid');
    return finish(denied ? 'repositories_not_accessible' : 'ready', details);
  }

  // ------------------------------------------------------------------- review
  private sandbox(context: RunnerContext, target: Target) {
    return (this.options.sandbox ?? dockerPublicationSandbox)(
      context,
      target.project,
      target.task.id,
      target.repositoryId,
    );
  }
  /**
   * Creates the commit object for `expectedRevision` in the sandbox, moves it
   * into the runner-owned mirror and checks it there: exact tree, remote
   * fast-forward, base, files and secrets across every commit to be pushed.
   */
  private async review(
    context: RunnerContext,
    target: Target,
    expectedRevision: string,
    draft: { message: string; date: number; tempRef: string },
  ): Promise<Review> {
    const sandbox = this.sandbox(context, target);
    const prepared = await sandbox.run({
      op: 'prepare',
      branch: target.branch,
      expectedRevision,
      message: draft.message,
      date: draft.date,
      identity: this.identity,
      tempRef: draft.tempRef,
    });
    const commitSha = String(prepared.commitSha);
    const headSha = String(prepared.headSha);
    const mirror = new Mirror(context.root, target.project.id, target.repositoryId);
    await mirror.ensure();
    const incoming = `refs/oinko/incoming/${draft.tempRef.split('/').pop()}`;
    try {
      await mirror.fetch(await sandbox.source(), draft.tempRef, incoming);
    } catch (error) {
      throw new PublicationError(
        'git_failed',
        `Não foi possível transferir o commit revisado do sandbox: ${error instanceof Error ? error.message.slice(-300) : ''}`,
        { retryable: true },
      );
    }
    // Content-addressed check on runner-owned data: the sandbox cannot swap it.
    const received = await mirror.revParse(incoming);
    // The objects stay (no gc runs in the mirror); only the temporary ref goes.
    await mirror.git(['update-ref', '-d', incoming], { allowFailure: true });
    if (received !== commitSha || `tree:${await mirror.commitTree(commitSha)}` !== expectedRevision)
      throw new PublicationError(
        'integrity_failed',
        'O commit recebido do sandbox não corresponde à revisão aprovada.',
      );
    const remote = await this.remote(context, target);
    const refs = await mirror.lsRemote(remote, [target.branch, target.baseBranch]);
    const branchSha = refs.get(target.branch) ?? null;
    const baseSha = refs.get(target.baseBranch) ?? null;
    const blockers: ErrorBody[] = [];
    if (baseSha && !(await mirror.hasCommit(baseSha)))
      await mirror.fetchRemote(remote, target.baseBranch, `refs/oinko/remote/${target.baseBranch}`);
    const mergeBase = baseSha ? ((await mirror.mergeBase(baseSha, commitSha)) ?? null) : null;
    // Informative: a branch behind its base still makes a valid PR.
    const containsBase = !!baseSha && mergeBase === baseSha;
    let fastForward = false;
    let diffBase: string | undefined = mergeBase ?? undefined;
    if (branchSha) {
      fastForward =
        branchSha === commitSha ||
        ((await mirror.hasCommit(branchSha)) && (await mirror.isAncestor(branchSha, commitSha)));
      if (!fastForward)
        blockers.push({
          code: 'remote_conflict',
          message:
            'O ramo remoto tem commits que não estão nesta revisão. Integre as mudanças remotas na tarefa; nada foi sobrescrito.',
          retryable: false,
          details: { remoteSha: branchSha },
        });
      else diffBase = branchSha;
    } else {
      if (!baseSha)
        blockers.push({
          code: 'base_not_found',
          message: `O ramo base ${target.baseBranch} não existe no repositório remoto.`,
          retryable: false,
        });
      else if (!mergeBase)
        blockers.push({
          code: 'base_not_found',
          message: `A revisão não compartilha histórico com ${target.baseBranch}.`,
          retryable: false,
        });
    }
    const exclude: string[] = [];
    for (const sha of [branchSha, baseSha])
      if (sha && (await mirror.hasCommit(sha))) exclude.push(sha);
    const commits = exclude.length ? (await mirror.revList(commitSha, exclude)).length : 0;
    const files = diffBase ? await mirror.files(diffBase, commitSha) : [];
    if (!branchSha && baseSha && mergeBase && commits === 0)
      blockers.push({
        code: 'no_changes',
        message: 'Não há mudanças em relação ao ramo base.',
        retryable: false,
      });
    let secrets: SecretFinding[] = [];
    if (exclude.length) {
      const known = this.knownSecrets(context);
      const touched = await mirror.touched(commitSha, exclude);
      const messages = await mirror.messages(commitSha, exclude);
      secrets = mergeFindings(
        scanPatch(await mirror.history(commitSha, exclude, REVIEW_LIMIT_BYTES), known),
        touched.flatMap((path) => {
          const rules = pathRules(path);
          return rules.length ? [{ path, rules }] : [];
        }),
        ...messages.map((entry) =>
          scanText(`commit:${entry.sha.slice(0, 12)}`, entry.message, known),
        ),
      );
    }
    if (secrets.length)
      blockers.push({
        code: 'secret_detected',
        message:
          'Possíveis segredos no conteúdo a publicar. Remova-os do histórico da tarefa antes de publicar.',
        retryable: false,
        details: { paths: secrets.map((finding) => finding.path), findings: secrets },
      });
    return {
      revision: expectedRevision,
      branch: target.branch,
      baseBranch: target.baseBranch,
      headSha,
      commitSha,
      created: !!prepared.created,
      remote: { branchSha, baseSha },
      fastForward: !!branchSha && fastForward,
      mergeBase,
      containsBase,
      commits,
      files,
      secrets,
      blockers,
      verdict: blockers.length ? 'blocked' : 'ready',
    };
  }
  private async reviewCommand(context: RunnerContext, command: Command<'reviewPublication'>) {
    const target = this.target(context, command.taskId, command.repositoryId);
    return context.serial(`publication:${target.project.id}:${target.repositoryId}`, async () => {
      const startedAt = Date.now();
      const tempRef = `refs/oinko/review/${randomUUID().slice(0, 12)}`;
      try {
        const review = await this.review(context, target, command.expectedRevision, {
          message: 'oinko: revisão de publicação',
          date: Math.floor(Date.now() / 1000),
          tempRef,
        });
        this.emit(
          context,
          'publication_reviewed',
          review.verdict === 'ready' ? 'succeeded' : 'denied',
          {
            target,
            startedAt,
            payload: {
              repositoryId: target.repositoryId,
              treeHash: review.revision,
              verdict: review.verdict,
            },
          },
        );
        for (const blocker of review.blockers)
          this.emit(context, 'publication_blocked', 'denied', {
            target,
            error: blocker,
            payload: { repositoryId: target.repositoryId, code: blocker.code },
          });
        const { commitSha, created, ...rest } = review;
        void commitSha;
        void created;
        return {
          ok: true,
          repositoryId: target.repositoryId,
          owner: target.owner,
          name: target.name,
          ...rest,
        };
      } catch (error) {
        const body = errorBody(this.normalize(error));
        if (BLOCKING.has(body.code))
          this.emit(context, 'publication_blocked', 'denied', {
            target,
            error: body,
            payload: { repositoryId: target.repositoryId, code: body.code },
          });
        throw error;
      } finally {
        await this.sandbox(context, target)
          .run({ op: 'cleanup', tempRef })
          .catch(() => undefined);
      }
    });
  }

  // ------------------------------------------------------------------ publish
  private async publish(context: RunnerContext, command: Command<'publish'>) {
    const target = this.target(context, command.taskId, command.repositoryId);
    const lock = `publication:${target.project.id}:${target.repositoryId}`;
    return context.serial(lock, async () => {
      const { receipt, existing } = this.begin(context, target, 'publish', command.operationId, {
        taskId: command.taskId,
        repositoryId: command.repositoryId,
        expectedRevision: command.expectedRevision,
        commitMessage: command.commitMessage,
        title: command.title,
        body: command.body,
        checks: command.checks,
      });
      if (existing && receipt.state === 'succeeded') return { ...receipt.result, replayed: true };
      if (existing && receipt.state === 'failed' && receipt.error && !receipt.error.retryable)
        return { ok: false, error: receipt.error, replayed: true };
      let push: Json;
      try {
        push = await this.push(context, target, command, receipt);
      } catch (error) {
        // The temporary ref is recreated by a retry; never leave it behind.
        await this.sandbox(context, target)
          .run({ op: 'cleanup', tempRef: this.tempRef(receipt.key) })
          .catch(() => undefined);
        throw this.fail(context, target, receipt, error, ['pushing']);
      }
      let pr: Json;
      try {
        // Same lock already held: call the unlocked step directly.
        pr = await this.ensureDraft(context, target, {
          operationId: `publish:${command.operationId}`,
          title: command.title,
          body: validationSection(command.body, command.checks, command.expectedRevision),
          replaceClosed: undefined,
        });
      } catch (error) {
        // The push stands; repeating the operation resumes at the PR step.
        this.save(receipt, { state: 'running', phase: 'pushed' });
        return { ok: false, error: errorBody(this.normalize(error), command.operationId), push };
      }
      const result = { ok: true, operationId: command.operationId, ...push, pullRequest: pr };
      this.save(receipt, { state: 'succeeded', phase: 'done', result });
      return result;
    });
  }
  private async push(
    context: RunnerContext,
    target: Target,
    command: Command<'publish'>,
    receipt: Receipt,
  ): Promise<Json> {
    const startedAt = Date.now();
    const mirror = new Mirror(context.root, target.project.id, target.repositoryId);
    // Mutated in place: `receipt.data` is what gets persisted.
    const data = receipt.data as {
      commitSha?: string;
      headSha?: string;
      created?: boolean;
      files?: unknown;
      outcome?: string;
      commitEmitted?: boolean;
    };
    const summary = (outcome: string, extra: Json = {}) => ({
      repositoryId: target.repositoryId,
      owner: target.owner,
      name: target.name,
      branch: target.branch,
      baseBranch: target.baseBranch,
      revision: command.expectedRevision,
      commitSha: data.commitSha,
      commitCreated: !!data.created,
      push: outcome,
      files: data.files ?? [],
      ...extra,
    });
    // A previous attempt may already have pushed: consult the remote first.
    if (
      data.commitSha &&
      (receipt.phase === 'pushed' || receipt.phase === 'pushing' || receipt.phase === 'advanced')
    ) {
      await mirror.ensure();
      const remote = await this.remote(context, target);
      const current = (await mirror.lsRemote(remote, [target.branch])).get(target.branch);
      if (current === data.commitSha) {
        const reconciled = receipt.phase !== 'pushed';
        data.outcome ??= 'reconciled';
        this.save(receipt, { state: 'running', phase: 'pushed' });
        if (reconciled)
          this.emit(context, 'operation_reconciled', 'succeeded', {
            target,
            operationId: receipt.operationId,
            payload: { kind: 'publish', state: 'succeeded', resolution: 'remote_has_commit' },
          });
        this.recordPublication(context, target, { remoteSha: current });
        return summary(data.outcome ?? 'reconciled', { reconciled });
      }
    }
    this.save(receipt, { state: 'running', phase: 'review' });
    const stale = command.checks.filter((check) => check.revision !== command.expectedRevision);
    if (stale.length)
      throw new PublicationError(
        'checks_stale',
        'Há validações de outra revisão; repita-as na revisão publicada ou omita-as.',
        { details: { stale: stale.map((check) => check.name ?? check.kind) } },
      );
    const known = this.knownSecrets(context);
    const text = mergeFindings(
      scanText('commit_message', command.commitMessage, known),
      scanText('pull_request.title', command.title, known),
      scanText('pull_request.body', command.body, known),
    );
    if (text.length)
      throw new PublicationError(
        'secret_detected',
        'Possíveis segredos na mensagem ou no texto do PR.',
        {
          details: { paths: text.map((finding) => finding.path), findings: text },
        },
      );
    const tempRef = this.tempRef(receipt.key);
    const sandbox = this.sandbox(context, target);
    const review = await this.review(context, target, command.expectedRevision, {
      message: command.commitMessage,
      // Same tree, parent, message, identity and date: a retry recreates the same commit.
      date: Math.floor(receipt.createdAt / 1000),
      tempRef,
    });
    // A retry finds the commit already on the branch; it was still created by this operation.
    Object.assign(data, {
      commitSha: review.commitSha,
      headSha: review.headSha,
      created: !!data.created || review.created,
      files: review.files,
    });
    this.save(receipt, { phase: 'reviewed' });
    this.emit(
      context,
      'publication_reviewed',
      review.verdict === 'ready' ? 'succeeded' : 'denied',
      {
        target,
        operationId: receipt.operationId,
        payload: {
          repositoryId: target.repositoryId,
          treeHash: review.revision,
          verdict: review.verdict,
        },
      },
    );
    if (review.blockers.length) {
      await sandbox.run({ op: 'cleanup', tempRef }).catch(() => undefined);
      const [first, ...others] = review.blockers;
      throw new PublicationError(first!.code, first!.message, {
        details: {
          ...first!.details,
          ...(others.length && { otherBlockers: others.map((item) => item.code) }),
        },
      });
    }
    await this.hook('reviewed');
    // Access and policy are re-read right before each effect.
    this.target(context, target.task.id, target.repositoryId);
    await sandbox.run({
      op: 'advance',
      branch: target.branch,
      commitSha: review.commitSha,
      expectedHead: review.headSha,
      tempRef,
    });
    const emitCommit = !!data.created && !data.commitEmitted;
    data.commitEmitted = true;
    this.save(receipt, { phase: 'advanced' });
    if (emitCommit)
      this.emit(context, 'git_commit_created', 'succeeded', {
        target,
        operationId: receipt.operationId,
        payload: { repositoryId: target.repositoryId, sha: review.commitSha },
      });
    await this.hook('advanced');
    this.target(context, target.task.id, target.repositoryId);
    const remote = await this.remote(context, target);
    this.save(receipt, { phase: 'pushing' });
    this.emit(context, 'git_push_started', 'started', {
      target,
      operationId: receipt.operationId,
      payload: { repositoryId: target.repositoryId, branch: target.branch, sha: review.commitSha },
    });
    const attempt = async (endpoint: GitEndpoint) =>
      mirror.push(endpoint, review.commitSha, target.branch);
    let outcome: PushOutcome | { status: 'reconciled' };
    try {
      outcome = await attempt(remote).catch(async (error: unknown) => {
        // An expired or revoked token: refresh once; GitHub then says why.
        if (!(error instanceof PublicationError) || error.code !== 'github_unauthorized')
          throw error;
        this.app().tokens.invalidate(target.installationId, target.owner, target.name);
        return attempt(await this.remote(context, target));
      });
    } catch (error) {
      // Access errors are answered before any ref update: a known failure.
      if (error instanceof PublicationError && ACCESS.has(error.code)) throw error;
      // Lost response or timeout: the ref may have moved. Ask before deciding.
      const current = await this.remote(context, target)
        .then((endpoint) => mirror.lsRemote(endpoint, [target.branch]))
        .then((refs) => refs.get(target.branch))
        .catch(() => undefined);
      if (current !== review.commitSha) throw error;
      outcome = { status: 'reconciled' };
    }
    await this.hook('pushed');
    const finished = (result: string, error?: ErrorBody) =>
      this.emit(context, 'git_push_finished', error ? 'failed' : 'succeeded', {
        target,
        operationId: receipt.operationId,
        startedAt,
        ...(error && { error }),
        payload: {
          repositoryId: target.repositoryId,
          branch: target.branch,
          sha: review.commitSha,
          result,
        },
      });
    if (outcome.status === 'rejected_non_fast_forward') {
      const error = new PublicationError(
        'remote_conflict',
        'O ramo remoto avançou com commits que não estão nesta revisão. Nada foi sobrescrito (sem force push); integre as mudanças remotas e publique de novo.',
      );
      finished(outcome.status, errorBody(error));
      this.save(receipt, { phase: 'rejected' });
      throw error;
    }
    if (outcome.status === 'rejected') {
      const error = new PublicationError(
        'push_rejected',
        `O GitHub recusou o push: ${outcome.reason ?? 'motivo desconhecido'}.`,
      );
      finished(outcome.status, errorBody(error));
      this.save(receipt, { phase: 'rejected' });
      throw error;
    }
    finished(outcome.status);
    data.outcome = outcome.status;
    this.save(receipt, { phase: 'pushed' });
    this.recordPublication(context, target, { remoteSha: review.commitSha });
    return summary(outcome.status, {
      review: {
        commits: review.commits,
        newBranch: !review.remote.branchSha,
        fastForward: review.fastForward,
      },
    });
  }
  private recordPublication(
    context: RunnerContext,
    target: Target,
    patch: Partial<PublicationRecord>,
  ): PublicationRecord {
    const previous = this.store.publication(target.publicationId);
    const runId = context.correlation?.runId;
    const botId = context.botId!;
    return this.store.savePublication({
      id: target.publicationId,
      projectId: target.project.id,
      taskId: target.task.id,
      repositoryId: target.repositoryId,
      owner: target.owner,
      name: target.name,
      branch: target.branch,
      baseBranch: target.baseBranch,
      originatingBotId: previous?.originatingBotId ?? botId,
      contributingBotIds: [...new Set([...(previous?.contributingBotIds ?? []), botId])],
      ...((previous?.originatingRunId ?? runId) && {
        originatingRunId: previous?.originatingRunId ?? runId,
      }),
      contributingRunIds: [
        ...new Set([...(previous?.contributingRunIds ?? []), ...(runId ? [runId] : [])]),
      ],
      reconciliationState: 'synced',
      ...(previous?.remoteSha && { remoteSha: previous.remoteSha }),
      ...(previous?.pullRequest && { pullRequest: previous.pullRequest }),
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  // ------------------------------------------------------------ pull requests
  private async ensureDraftCommand(
    context: RunnerContext,
    command: Command<'ensureDraftPullRequest'>,
  ) {
    const target = this.target(context, command.taskId, command.repositoryId);
    return context.serial(`publication:${target.project.id}:${target.repositoryId}`, () =>
      this.ensureDraft(context, target, command),
    );
  }
  private async pulls(context: RunnerContext, target: Target): Promise<Json[]> {
    const all: Json[] = [];
    for (let page = 1; page <= 5; page++) {
      const response = await this.api<Json[]>(
        context,
        target,
        'GET',
        `/pulls?head=${encodeURIComponent(`${target.owner}:${target.branch}`)}&state=all&per_page=100&page=${page}`,
      );
      const items = Array.isArray(response.data) ? response.data : [];
      all.push(...items);
      if (items.length < 100) break;
    }
    // Only PRs whose head is this repository's task branch.
    return all.filter((pr) => {
      const head = (pr.head ?? {}) as Json;
      const repo = (head.repo ?? {}) as Json;
      return (
        head.ref === target.branch &&
        (!repo.full_name ||
          String(repo.full_name).toLowerCase() === `${target.owner}/${target.name}`.toLowerCase())
      );
    });
  }
  private describe(target: Target, pr: Json, resolution: string, related: Json[]) {
    const head = (pr.head ?? {}) as Json;
    return {
      ok: true,
      repositoryId: target.repositoryId,
      owner: target.owner,
      name: target.name,
      branch: target.branch,
      baseBranch: target.baseBranch,
      number: Number(pr.number),
      url: String(pr.html_url ?? ''),
      state: pr.merged_at ? 'merged' : String(pr.state ?? 'open'),
      draft: !!pr.draft,
      headSha: head.sha ?? null,
      resolution,
      related,
    };
  }
  private async ensureDraft(
    context: RunnerContext,
    target: Target,
    command: Pick<
      Command<'ensureDraftPullRequest'>,
      'operationId' | 'title' | 'body' | 'replaceClosed'
    >,
  ) {
    const startedAt = Date.now();
    const { receipt, existing } = this.begin(
      context,
      target,
      'ensureDraftPullRequest',
      command.operationId,
      {
        taskId: target.task.id,
        repositoryId: target.repositoryId,
        title: command.title,
        body: command.body,
        replaceClosed: command.replaceClosed ?? null,
      },
    );
    if (existing && receipt.state === 'succeeded') return { ...receipt.result, replayed: true };
    if (existing && receipt.state === 'failed' && receipt.error && !receipt.error.retryable)
      return { ok: false, error: receipt.error, replayed: true };
    const wasUncertain = existing && receipt.state !== 'failed';
    try {
      const known = this.knownSecrets(context);
      const text = mergeFindings(
        scanText('pull_request.title', command.title, known),
        scanText('pull_request.body', command.body, known),
      );
      if (text.length)
        throw new PublicationError(
          'secret_detected',
          'Possíveis segredos no título ou na descrição do PR.',
          {
            details: { paths: text.map((finding) => finding.path), findings: text },
          },
        );
      const mirror = new Mirror(context.root, target.project.id, target.repositoryId);
      await mirror.ensure();
      const remoteSha = (
        await mirror.lsRemote(await this.remote(context, target), [target.branch])
      ).get(target.branch);
      if (!remoteSha)
        throw new PublicationError(
          'branch_not_published',
          'O ramo da tarefa ainda não foi publicado; publique antes de abrir o PR.',
        );
      const related = this.store
        .publications(target.project.id, target.task.id)
        .filter((item) => item.repositoryId !== target.repositoryId && item.pullRequest)
        .map((item) => ({
          repositoryId: item.repositoryId,
          owner: item.owner,
          name: item.name,
          number: item.pullRequest!.number,
          url: item.pullRequest!.url,
        }));
      const body = relatedSection(command.body, related);
      this.save(receipt, { state: 'running', phase: 'lookup' });
      const found = await this.pulls(context, target);
      const open = found
        .filter((pr) => pr.state === 'open')
        .sort((a, b) => Number(a.number) - Number(b.number));
      let pr: Json;
      let resolution: 'created' | 'updated' | 'reconciled';
      if (open.length) {
        this.target(context, target.task.id, target.repositoryId);
        // Only title and body change: draft/ready, reviews and merge are never touched.
        pr = (
          await this.api<Json>(context, target, 'PATCH', `/pulls/${Number(open[0]!.number)}`, {
            title: command.title,
            body,
          })
        ).data;
        resolution = wasUncertain ? 'reconciled' : 'updated';
      } else {
        const closed = found.sort((a, b) => Number(b.number) - Number(a.number))[0];
        if (closed && command.replaceClosed !== Number(closed.number))
          throw new PublicationError(
            'pr_closed',
            `O PR #${Number(closed.number)} desta tarefa foi ${closed.merged_at ? 'mesclado' : 'fechado'}. Decida explicitamente: reabra-o manualmente ou peça um novo draft informando replaceClosed=${Number(closed.number)}.`,
            {
              details: {
                number: Number(closed.number),
                url: closed.html_url ?? null,
                merged: !!closed.merged_at,
              },
            },
          );
        const created = await this.createDraft(context, target, receipt, command.title, body);
        pr = created.pr;
        resolution = created.resolution;
      }
      const result = this.describe(target, pr, resolution, related);
      this.save(receipt, { state: 'succeeded', phase: 'done', result });
      this.recordPublication(context, target, {
        remoteSha,
        pullRequest: {
          number: result.number,
          url: result.url,
          state: result.state,
          draft: result.draft,
          merged: result.state === 'merged',
        },
      });
      const type =
        resolution === 'created'
          ? 'draft_pull_request_created'
          : resolution === 'updated'
            ? 'draft_pull_request_updated'
            : 'pull_request_reconciled';
      this.emit(context, type, 'succeeded', {
        target,
        operationId: command.operationId,
        startedAt,
        payload:
          type === 'pull_request_reconciled'
            ? {
                repositoryId: target.repositoryId,
                resolution: 'found_existing',
                prState: result.state,
                prNumber: result.number,
              }
            : { repositoryId: target.repositoryId, prNumber: result.number },
      });
      return result;
    } catch (error) {
      throw this.fail(context, target, receipt, error, []);
    }
  }
  /** Create with lookup-before-retry: a lost response never yields a second PR. */
  private async createDraft(
    context: RunnerContext,
    target: Target,
    receipt: Receipt,
    title: string,
    body: string,
  ) {
    const attempts = this.options.createAttempts ?? 3;
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        const existing = (await this.pulls(context, target)).find((pr) => pr.state === 'open');
        if (existing) {
          this.emit(context, 'operation_reconciled', 'succeeded', {
            target,
            operationId: receipt.operationId,
            payload: {
              kind: 'ensureDraftPullRequest',
              state: 'succeeded',
              resolution: 'found_after_uncertain_create',
            },
          });
          return { pr: existing, resolution: 'reconciled' as const };
        }
      }
      this.target(context, target.task.id, target.repositoryId);
      this.save(receipt, { state: 'running', phase: 'creating' });
      try {
        const response = await this.api<Json>(context, target, 'POST', '/pulls', {
          title,
          body,
          head: target.branch,
          base: target.baseBranch,
          draft: true,
          maintainer_can_modify: false,
        });
        return { pr: response.data, resolution: 'created' as const };
      } catch (error) {
        if (!(error instanceof PublicationError)) throw error;
        const text =
          String(error.details?.githubMessage ?? '') + String(error.details?.errors ?? '');
        if (error.code === 'github_validation_failed') {
          if (/already exists/i.test(text)) {
            last = error;
            continue; // the lookup at the top of the loop finds it
          }
          if (/draft/i.test(text))
            throw new PublicationError(
              'draft_not_supported',
              'Este repositório não aceita draft PR; nenhum PR normal foi aberto.',
            );
          if (/no commits between/i.test(text))
            throw new PublicationError(
              'no_changes',
              'Não há commits entre o ramo da tarefa e o ramo base.',
            );
          throw error;
        }
        if (!error.uncertain && !error.retryable) throw error;
        last = error;
        this.save(receipt, { state: 'uncertain', phase: 'creating' });
        this.emit(context, 'operation_uncertain', 'uncertain', {
          target,
          operationId: receipt.operationId,
          payload: { kind: 'ensureDraftPullRequest', state: 'uncertain', code: error.code },
        });
      }
    }
    const existing = (await this.pulls(context, target)).find((pr) => pr.state === 'open');
    if (existing) return { pr: existing, resolution: 'reconciled' as const };
    throw last instanceof PublicationError && last.code !== 'github_validation_failed'
      ? new PublicationError(last.code, last.message, { retryable: true, uncertain: true })
      : new PublicationError('operation_uncertain', 'Não foi possível confirmar a criação do PR.', {
          retryable: true,
          uncertain: true,
        });
  }

  // ------------------------------------------------------------ reconciliation
  private async reconcile(context: RunnerContext, command: Command<'reconcilePublication'>) {
    const target = this.target(context, command.taskId, command.repositoryId);
    return context.serial(`publication:${target.project.id}:${target.repositoryId}`, async () => {
      const mirror = new Mirror(context.root, target.project.id, target.repositoryId);
      await mirror.ensure();
      const refs = await mirror.lsRemote(await this.remote(context, target), [
        target.branch,
        target.baseBranch,
      ]);
      const remoteSha = refs.get(target.branch) ?? null;
      const prs = (await this.pulls(context, target)).sort(
        (a, b) => Number(b.number) - Number(a.number),
      );
      const open = prs.find((pr) => pr.state === 'open');
      const pullRequests = prs.map((pr) => {
        const described = this.describe(target, pr, 'observed', []);
        return {
          number: described.number,
          url: described.url,
          state: described.state,
          draft: described.draft,
          headSha: described.headSha,
        };
      });
      let local: Json;
      try {
        const inspected = await this.sandbox(context, target).run({
          op: 'inspect',
          branch: target.branch,
        });
        local = {
          available: true,
          branchRef: inspected.branchRef,
          headSha: inspected.headSha,
          revision: inspected.revision,
        };
      } catch (error) {
        local = { available: false, code: errorBody(this.normalize(error)).code };
      }
      const receipts = this.store.receipts(target.project.id, target.task.id, target.repositoryId);
      for (const receipt of receipts) {
        if (!['intended', 'running', 'uncertain'].includes(receipt.state)) continue;
        const commitSha = (receipt.data as { commitSha?: string }).commitSha;
        let resolved: string | undefined;
        if (receipt.action === 'ensureDraftPullRequest' && open && receipt.phase === 'creating') {
          // The uncertain effect was the creation, and the PR exists. An
          // interrupted update is left to the repeat, which re-applies it.
          const result = this.describe(target, open, 'reconciled', []);
          this.save(receipt, { state: 'succeeded', phase: 'done', result });
          resolved = 'pull_request_found';
        } else if (receipt.action === 'publish' && commitSha && commitSha === remoteSha) {
          // The push happened; the PR step resumes when the same operation is repeated.
          if (receipt.state !== 'running' || receipt.phase !== 'pushed') {
            this.save(receipt, { state: 'running', phase: 'pushed' });
            resolved = 'remote_has_commit';
          }
        } else if (receipt.state !== 'uncertain') {
          this.save(receipt, { state: 'uncertain' });
        }
        if (resolved)
          this.emit(context, 'operation_reconciled', 'succeeded', {
            target,
            operationId: receipt.operationId,
            payload: { kind: receipt.action, state: receipt.state, resolution: resolved },
          });
      }
      const localHead = local.available ? String(local.headSha ?? '') : undefined;
      const state = !remoteSha
        ? 'unpublished'
        : localHead === undefined
          ? 'unknown'
          : localHead === remoteSha
            ? 'synced'
            : 'differs';
      const openPr = open ? this.describe(target, open, 'observed', []) : undefined;
      this.recordPublication(context, target, {
        ...(remoteSha && { remoteSha }),
        ...(openPr && {
          pullRequest: {
            number: openPr.number,
            url: openPr.url,
            state: openPr.state,
            draft: openPr.draft,
            merged: false,
          },
        }),
        reconciliationState:
          state === 'synced'
            ? 'synced'
            : state === 'unpublished'
              ? 'unpublished'
              : state === 'differs'
                ? 'diverged'
                : 'uncertain',
      });
      this.emit(context, 'pull_request_reconciled', 'succeeded', {
        target,
        payload: {
          repositoryId: target.repositoryId,
          resolution: state,
          prState: openPr?.state ?? (prs[0] ? 'closed' : 'none'),
        },
      });
      return {
        ok: true,
        repositoryId: target.repositoryId,
        owner: target.owner,
        name: target.name,
        branch: target.branch,
        baseBranch: target.baseBranch,
        state,
        remote: {
          exists: !!remoteSha,
          sha: remoteSha,
          baseSha: refs.get(target.baseBranch) ?? null,
        },
        local,
        pullRequest: openPr ?? null,
        pullRequests,
        receipts: this.store
          .receipts(target.project.id, target.task.id, target.repositoryId)
          .map((receipt) => ({
            operationId: receipt.operationId,
            action: receipt.action,
            state: receipt.state,
            phase: receipt.phase,
          })),
        related: this.store
          .publications(target.project.id, target.task.id)
          .filter((item) => item.pullRequest)
          .map((item) => ({
            repositoryId: item.repositoryId,
            owner: item.owner,
            name: item.name,
            number: item.pullRequest!.number,
            url: item.pullRequest!.url,
          })),
      };
    });
  }

  // ------------------------------------------------------------------- checks
  private async required(context: RunnerContext, target: Target): Promise<string[] | 'unknown'> {
    const names = new Set<string>();
    let classic = false;
    let rules = false;
    try {
      const branch = (
        await this.api<Json>(
          context,
          target,
          'GET',
          `/branches/${encodeURIComponent(target.baseBranch)}`,
        )
      ).data;
      const protection = branch.protection as Json | undefined;
      const checks = protection?.required_status_checks as Json | undefined;
      if (branch.protected === false) classic = true;
      if (checks) {
        classic = true;
        for (const name of (checks.contexts as string[] | undefined) ?? []) names.add(name);
        for (const check of (checks.checks as Json[] | undefined) ?? [])
          names.add(String(check.context));
      }
    } catch (error) {
      if (error instanceof PublicationError && error.code === 'rate_limited') throw error;
    }
    try {
      const response = await this.api<Json[]>(
        context,
        target,
        'GET',
        `/rules/branches/${encodeURIComponent(target.baseBranch)}`,
      );
      if (Array.isArray(response.data)) {
        rules = true;
        for (const rule of response.data)
          if (rule.type === 'required_status_checks')
            for (const check of ((rule.parameters as Json | undefined)?.required_status_checks as
              Json[] | undefined) ?? [])
              names.add(String(check.context));
      }
    } catch (error) {
      if (error instanceof PublicationError && error.code === 'rate_limited') throw error;
    }
    return classic && rules ? [...names].sort() : 'unknown';
  }
  private async inspectChecks(context: RunnerContext, command: Command<'inspectChecks'>) {
    const target = this.target(context, command.taskId, command.repositoryId);
    const startedAt = Date.now();
    const base = {
      ok: true,
      repositoryId: target.repositoryId,
      owner: target.owner,
      name: target.name,
      sha: command.sha,
      branch: target.branch,
      polledAt: new Date().toISOString(),
    };
    try {
      let headSha: string | null = null;
      try {
        const mirror = new Mirror(context.root, target.project.id, target.repositoryId);
        await mirror.ensure();
        headSha =
          (await mirror.lsRemote(await this.remote(context, target), [target.branch])).get(
            target.branch,
          ) ?? null;
      } catch (error) {
        if (
          error instanceof PublicationError &&
          [
            'installation_not_found',
            'insufficient_permissions',
            'repository_not_accessible',
          ].includes(error.code)
        )
          throw error;
      }
      const runs: Json[] = [];
      for (let page = 1; page <= 10; page++) {
        const response = await this.api<Json>(
          context,
          target,
          'GET',
          `/commits/${command.sha}/check-runs?per_page=100&page=${page}`,
        );
        const items = Array.isArray(response.data.check_runs)
          ? (response.data.check_runs as Json[])
          : [];
        runs.push(...items);
        if (items.length < 100 || runs.length >= Number(response.data.total_count ?? 0)) break;
      }
      const combined = (
        await this.api<Json>(context, target, 'GET', `/commits/${command.sha}/status?per_page=100`)
      ).data;
      if (combined.sha !== undefined && combined.sha !== command.sha)
        throw new PublicationError('commit_not_found', 'O GitHub respondeu por outro commit.');
      const statuses = Array.isArray(combined.statuses) ? (combined.statuses as Json[]) : [];
      const required = await this.required(context, target);
      const normalized = normalizeChecks(command.sha, runs, statuses, required);
      const observationId = `checks:${target.project.id}:${target.repositoryId}:${command.sha}`;
      const previous = this.store.observation<Record<string, string>>(observationId) ?? {};
      const next: Record<string, string> = {};
      for (const check of normalized.checks) {
        next[check.name] = check.state;
        if (previous[check.name] !== check.state)
          this.emit(context, 'ci_check_updated', 'info', {
            target,
            payload: {
              repositoryId: target.repositoryId,
              sha: command.sha,
              check: check.name,
              status: check.state,
            },
          });
      }
      this.store.saveObservation(observationId, next);
      const current = headSha === null ? 'unknown' : headSha === command.sha;
      this.emit(context, 'ci_poll_finished', 'succeeded', {
        target,
        startedAt,
        payload: {
          repositoryId: target.repositoryId,
          sha: command.sha,
          overall: normalized.state,
          current: String(current),
        },
      });
      return {
        ...base,
        headSha,
        current,
        ...(current === false && { supersededBy: headSha }),
        state: normalized.state,
        reason: normalized.reason,
        checks: normalized.checks satisfies CiCheck[],
        required,
        missingRequired: normalized.missingRequired,
        fullyValidated: normalized.state === 'passed' && current === true,
      };
    } catch (error) {
      const body = errorBody(this.normalize(error));
      if (
        [
          'publisher_required',
          'not_found',
          'github_app_not_configured',
          'master_key_missing',
        ].includes(body.code) &&
        !(error instanceof PublicationError && error.status)
      )
        throw error;
      const code =
        body.code === 'github_validation_failed' ||
        (body.code === 'not_found' && error instanceof PublicationError && error.status === 404)
          ? 'commit_not_found'
          : body.code;
      this.emit(context, 'ci_status_unavailable', 'failed', {
        target,
        startedAt,
        error: { ...body, code: code as ErrorBody['code'] },
        payload: { repositoryId: target.repositoryId, sha: command.sha, code },
      });
      return {
        ...base,
        headSha: null,
        current: 'unknown',
        state: 'unknown',
        reason: 'unavailable',
        checks: [],
        required: 'unknown',
        missingRequired: [],
        fullyValidated: false,
        unavailable: {
          code,
          message: body.message,
          retryable: body.retryable,
          ...(body.details?.retryAfterSeconds !== undefined && {
            retryAfterSeconds: body.details.retryAfterSeconds,
          }),
          ...(body.details?.resetAt !== undefined && { resetAt: body.details.resetAt }),
        },
      };
    }
  }

  // ------------------------------------------------------------------- events
  private async events(context: RunnerContext, command: Command<'publicationEvents'>) {
    let projectIds: string[] | undefined;
    if (context.botId) {
      const visible = context.workspaces
        .projects()
        .filter((project) => project.allowedBotIds.includes(context.botId!))
        .map((project) => project.id);
      projectIds = command.projectId ? visible.filter((id) => id === command.projectId) : visible;
    } else if (command.projectId) projectIds = [command.projectId];
    const events = this.store.events({
      after: command.after,
      limit: command.limit,
      ...(projectIds && { projectIds }),
    });
    return { ok: true, events, next: events.at(-1)?.seq ?? command.after };
  }

  /** Runner start: unfinished receipts become explicit uncertainty. */
  recover() {
    for (const receipt of this.store.markInterrupted())
      this.store.record({
        type: 'operation_uncertain',
        status: 'uncertain',
        occurredAt: Date.now(),
        botId: receipt.botId,
        projectId: receipt.projectId,
        taskId: receipt.taskId,
        operationId: receipt.operationId,
        ...(receipt.runId && { runId: receipt.runId }),
        payload: { kind: receipt.action, state: 'uncertain', phase: receipt.phase },
      });
  }
}

function validationSection(body: string, checks: LocalCheckValue[], revision: string) {
  const lines = checks.map((check) => `- ${check.name ?? check.kind}: ${check.result}`);
  const section = [
    '<!-- oinko:validation -->',
    `**Validações locais** (revisão \`${revision.slice(0, 17)}\`)`,
    ...(lines.length ? lines : ['- Nenhuma validação local informada.']),
    '',
    'CI remoto: acompanhe os checks do PR; este draft não está validado integralmente até o CI concluir.',
    '<!-- /oinko:validation -->',
  ].join('\n');
  return `${stripSection(body, 'validation')}\n\n${section}`.trim();
}
function relatedSection(
  body: string,
  related: { owner: string; name: string; number: number; url: string }[],
) {
  const clean = stripSection(body, 'related');
  if (!related.length) return clean;
  return `${clean}\n\n<!-- oinko:related -->\n**Pull requests relacionados desta tarefa**\n${related
    .map((item) => `- ${item.owner}/${item.name}#${item.number}`)
    .join('\n')}\n<!-- /oinko:related -->`.trim();
}
function stripSection(body: string, name: string) {
  return body
    .replace(new RegExp(`\\n*<!-- oinko:${name} -->[\\s\\S]*?<!-- /oinko:${name} -->`, 'g'), '')
    .trim();
}
