import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Project } from '@oinko/workspaces';
import type { RunnerCommandValue } from '../contracts/requests.js';
import type { RunnerContext, RunnerExtension } from '../runtime/extensions.js';
import { BROWSER_BASE_IMAGE, BrowserRuntime, PLAYWRIGHT_VERSION } from './container.js';
import { BrowserError, toFailure } from './errors.js';
import { NetworkPolicy, formatOrigin, type PolicySource } from './policy.js';
import { EgressProxy, type DecisionRecord } from './proxy.js';
import { Redactor } from './redact.js';
import { BrowserSession } from './session.js';
import { BrowserStore, type SessionRecord, type SessionState } from './store.js';

type Command = RunnerCommandValue;
type BaseContext = Omit<RunnerContext, 'botId' | 'correlation'>;
type SessionCommand = Extract<Command, { sessionId: string; runId?: string }>;

export interface BrowserExtensionOptions {
  /** Stop the browser container this long after the last session ends. */
  idleMs?: number;
  /** Close sessions without actions for this long. */
  sessionIdleMs?: number;
  maxSessions?: number;
  maxSessionsPerBot?: number;
  /** Address the egress proxy listens on (defaults per platform). */
  proxyHost?: string;
}

const ACTIONS = [
  'browserStatus',
  'browserSession',
  'browserNavigate',
  'browserSnapshot',
  'browserClick',
  'browserFill',
  'browserWait',
  'browserScreenshot',
  'browserDiagnostics',
  'browserClose',
  'browserSaveCredential',
  'browserDeleteCredential',
  'browserCredentials',
] as const;
const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };
const RELAY_PROXY = 'http://relay:3128';

interface Env {
  root: string;
  store: BrowserStore;
  policy: NetworkPolicy;
  proxy: EgressProxy;
  runtime: BrowserRuntime;
  base: BaseContext;
}

/** Operator override of a timer, in milliseconds; ignored unless a positive integer. */
function envMs(name: string) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function forbidden(message: string) {
  return new BrowserError('forbidden', message);
}

/** Docker Desktop reaches host loopback through host.docker.internal; Linux needs the bridge gateway. */
async function proxyHost(context: BaseContext) {
  if (process.env.OINKO_BROWSER_PROXY_HOST) return process.env.OINKO_BROWSER_PROXY_HOST;
  if (process.platform !== 'linux') return '127.0.0.1';
  const gateway = await context.sandbox.run(
    'docker',
    ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'],
    { allowFailure: true, timeoutMs: 10_000 },
  );
  return gateway.stdout.trim() || '172.17.0.1';
}

/**
 * Isolated browser sessions for previews and public docs (M05). One managed
 * Chromium container per runner; one BrowserContext per session, bound to a
 * bot, run, project and kind; every request through the egress proxy.
 */
export class BrowserExtension implements RunnerExtension {
  readonly actions: ReadonlySet<string> = new Set<string>(ACTIONS);
  private env?: Env;
  private listening?: Promise<{ host: string; port: number }>;
  private address?: { host: string; port: number };
  private readonly sessions = new Map<string, BrowserSession>();
  private idleTimer?: NodeJS.Timeout;
  private sweeper?: NodeJS.Timeout;
  constructor(private readonly options: BrowserExtensionOptions = {}) {}

  private setup(context: BaseContext): Env {
    if (this.env) return this.env;
    const store = new BrowserStore(context.root);
    const source: PolicySource = {
      project: (id) => {
        try {
          return context.workspaces.project(id);
        } catch {
          return undefined;
        }
      },
      previews: () => context.environments.previews(),
      settings: () => context.environments.settings(),
    };
    const policy = new NetworkPolicy(source);
    const proxy = new EgressProxy({
      policy,
      onDecision: (sessionId, decision) => {
        if (decision.code === 'access_revoked' || decision.code === 'browser_disabled')
          void this.end(sessionId, 'revoked', decision.code);
      },
    });
    const runtime = new BrowserRuntime({
      root: context.root,
      namespace: context.sandbox.namespace,
      run: context.sandbox.run,
      proxy: () => this.address!,
      onDisconnected: (code) => this.failAll(code),
    });
    this.env = { root: context.root, store, policy, proxy, runtime, base: context };
    return this.env;
  }

  private async proxyAddress(env: Env) {
    this.listening ??= proxyHost(env.base).then((host) =>
      env.proxy.listen(this.options.proxyHost ?? host, 0),
    );
    this.address = await this.listening;
    return this.address;
  }

  async handle(command: Command, context: RunnerContext): Promise<unknown> {
    const env = this.setup(context);
    try {
      switch (command.action) {
        case 'browserStatus':
          return this.status(env, command.sessionId, context.botId);
        case 'browserSaveCredential':
        case 'browserDeleteCredential':
        case 'browserCredentials':
          return this.credentials(env, command, context);
        case 'browserSession':
          return await this.create(env, command, context);
        case 'browserClose':
          return await this.closeSession(env, command, context);
        case 'browserNavigate':
        case 'browserSnapshot':
        case 'browserClick':
        case 'browserFill':
        case 'browserWait':
        case 'browserScreenshot':
        case 'browserDiagnostics':
          return await this.act(env, command, context);
        default:
          throw new BrowserError('forbidden', `Ação de browser desconhecida: ${command.action}`);
      }
    } catch (error) {
      return toFailure(error, (text) => context.redact(text));
    }
  }

  private runId(explicit: string | undefined, context: RunnerContext) {
    const correlated = context.correlation?.runId;
    if (explicit && correlated && explicit !== correlated)
      throw new BrowserError(
        'run_mismatch',
        'O runId do comando difere da correlação da requisição.',
      );
    const runId = explicit ?? correlated;
    if (!runId)
      throw new BrowserError('run_required', 'Informe o runId da execução dona da sessão.');
    return runId;
  }

  /** Current access, re-read now: revocation applies to the next action. */
  private access(context: BaseContext, projectId: string, botId: string): Project {
    let project: Project;
    try {
      project = context.workspaces.authorize(projectId, botId);
    } catch {
      throw new BrowserError('access_revoked', 'O bot não tem mais acesso a este projeto.');
    }
    if (!project.programming?.browser?.enabled)
      throw new BrowserError('browser_disabled', 'O navegador não está habilitado neste projeto.');
    return project;
  }

  private redactor(env: Env, projectId: string) {
    const values = [...env.store.secrets(projectId)];
    try {
      const project = env.base.workspaces.project(projectId);
      for (const id of new Set([project.environmentId, ...(project.environmentIds ?? [])]))
        if (id) values.push(...Object.values(env.base.environments.secrets(id)));
    } catch {
      // A missing project leaves only the credential values to redact.
    }
    return new Redactor(values);
  }

  private status(env: Env, sessionId: string | undefined, botId: string | undefined) {
    let records = env.store.sessions().filter((record) => !botId || record.botId === botId);
    if (sessionId) {
      records = records.filter((record) => record.id === sessionId);
      if (!records.length) throw new BrowserError('session_not_found', 'Sessão não encontrada.');
    }
    return {
      ...env.runtime.status(),
      sessions: records.slice(0, 50).map((record) => {
        const live = this.sessions.get(record.id);
        return {
          sessionId: record.id,
          ...(!botId && { botId: record.botId }),
          runId: record.runId,
          projectId: record.projectId,
          kind: record.kind,
          state: record.state,
          createdAt: record.createdAt,
          viewport: record.viewport,
          mobile: record.mobile,
          ...(record.closedAt && { closedAt: record.closedAt }),
          ...(record.reason && { reason: record.reason }),
          ...(record.code && { code: record.code }),
          ...(live && {
            lastUsedAt: new Date(live.lastUsed).toISOString(),
            buffered: live.pending,
          }),
        };
      }),
    };
  }

  private credentials(
    env: Env,
    command: Extract<
      Command,
      { action: 'browserSaveCredential' | 'browserDeleteCredential' | 'browserCredentials' }
    >,
    context: RunnerContext,
  ) {
    if (context.botId) throw forbidden('Esta operação pertence ao administrador.');
    try {
      context.workspaces.project(command.projectId);
    } catch {
      throw new BrowserError('forbidden', 'Projeto não encontrado.');
    }
    if (command.action === 'browserSaveCredential')
      return env.store.saveCredential(
        command.projectId,
        command.name,
        command.username,
        command.password,
      );
    if (command.action === 'browserDeleteCredential')
      return {
        projectId: command.projectId,
        name: command.name,
        deleted: env.store.deleteCredential(command.projectId, command.name),
      };
    return {
      projectId: command.projectId,
      credentials: env.store.credentialNames(command.projectId),
    };
  }

  private async create(
    env: Env,
    command: Extract<Command, { action: 'browserSession' }>,
    context: RunnerContext,
  ) {
    const botId = context.botId;
    if (!botId) throw forbidden('Sessões de navegador pertencem a um bot e a uma execução.');
    const runId = this.runId(command.runId, context);
    let project: Project;
    try {
      project = this.access(context, command.projectId, botId);
    } catch (error) {
      if (error instanceof BrowserError && error.code === 'access_revoked')
        throw forbidden('Projeto indisponível para este bot.');
      throw error;
    }
    const live = [...this.sessions.values()];
    if (live.length >= (this.options.maxSessions ?? 12))
      throw new BrowserError(
        'session_limit',
        'Limite de sessões de navegador atingido neste gerenciador.',
      );
    if (
      live.filter((session) => session.record.botId === botId).length >=
      (this.options.maxSessionsPerBot ?? 4)
    )
      throw new BrowserError(
        'session_limit',
        'Limite de sessões de navegador deste bot atingido. Encerre uma sessão.',
      );
    await this.proxyAddress(env);
    const browser = await env.runtime.ensure();
    clearTimeout(this.idleTimer);
    const id = `bs-${randomBytes(12).toString('hex')}`;
    const viewport = command.viewport ?? (command.mobile ? MOBILE : DESKTOP);
    const record: SessionRecord = {
      id,
      botId,
      runId,
      projectId: project.id,
      kind: command.kind,
      state: 'active',
      createdAt: new Date().toISOString(),
      viewport,
      mobile: command.mobile,
    };
    const credentials = env.proxy.register({
      sessionId: id,
      botId,
      projectId: project.id,
      kind: command.kind,
    });
    let session: BrowserSession;
    try {
      const browserContext = await browser.newContext({
        proxy: {
          server: RELAY_PROXY,
          username: credentials.username,
          password: credentials.password,
        },
        acceptDownloads: false,
        serviceWorkers: 'block',
        viewport,
        isMobile: command.mobile,
        hasTouch: command.mobile,
        deviceScaleFactor: 1,
        ignoreHTTPSErrors: false,
        bypassCSP: false,
        permissions: [],
      });
      try {
        const page = await browserContext.newPage();
        session = new BrowserSession(record, browserContext, page, {
          redactor: () => this.redactor(env, project.id),
          previewFor: (url) => env.policy.previewFor(project.id, url),
        });
      } catch (error) {
        await browserContext.close().catch(() => {});
        throw error;
      }
    } catch (error) {
      env.proxy.unregister(id);
      if (!env.runtime.connected)
        throw new BrowserError(
          'browser_unavailable',
          'O navegador ficou indisponível ao criar a sessão.',
          {
            reason: 'browser_crashed',
          },
        );
      throw error;
    }
    env.store.saveSession(record);
    this.sessions.set(id, session);
    this.sweep();
    return {
      sessionId: id,
      runId,
      projectId: project.id,
      kind: command.kind,
      viewport,
      mobile: command.mobile,
      createdAt: record.createdAt,
      image: env.runtime.image,
      baseImage: BROWSER_BASE_IMAGE,
      ...(env.runtime.baseDigest && { baseDigest: env.runtime.baseDigest }),
      playwrightVersion: PLAYWRIGHT_VERSION,
      chromiumVersion: env.runtime.chromiumVersion,
      sandbox: 'enabled',
    };
  }

  /** Ownership check: another bot or run gets the same answer as an unknown ID. */
  private owned(env: Env, command: SessionCommand, context: RunnerContext) {
    const record = env.store.session(command.sessionId);
    const botId = context.botId;
    if (!botId) return record;
    if (!record || record.botId !== botId)
      throw new BrowserError('session_not_found', 'Sessão não encontrada.');
    if (record.runId !== this.runId(command.runId, context))
      throw new BrowserError('session_not_found', 'Sessão não encontrada.');
    return record;
  }

  private ended(record: SessionRecord) {
    if (record.state === 'failed')
      return new BrowserError(
        'session_failed',
        'A sessão foi encerrada por falha do navegador ou reinício do gerenciador.',
        {
          state: record.state,
          failure: record.code,
        },
      );
    return new BrowserError('session_closed', 'A sessão foi encerrada. Crie uma nova sessão.', {
      state: record.state,
      ...(record.reason && { reason: record.reason }),
    });
  }

  private async act(
    env: Env,
    command: Extract<SessionCommand, { action: `browser${string}` }>,
    context: RunnerContext,
  ) {
    if (!context.botId)
      throw forbidden('O administrador pode consultar e encerrar sessões, não agir nelas.');
    const record = this.owned(env, command, context)!;
    if (record.state !== 'active') throw this.ended(record);
    const session = this.sessions.get(record.id);
    if (!session) throw this.ended({ ...record, state: 'failed', code: 'runner_restarted' });
    try {
      this.access(context, record.projectId, record.botId);
    } catch (error) {
      const code =
        error instanceof BrowserError && error.code === 'browser_disabled'
          ? 'browser_disabled'
          : 'access_revoked';
      await this.end(record.id, 'revoked', code);
      throw error;
    }
    try {
      const result = await session.run(() => this.perform(env, session, command));
      return { sessionId: record.id, ...result, decisions: env.proxy.decisions(record.id) };
    } catch (error) {
      const decisions = env.proxy.decisions(record.id);
      const failure = this.explain(error, command, decisions);
      if (
        !env.runtime.connected &&
        !(failure instanceof BrowserError && failure.code === 'navigation_denied')
      ) {
        const unavailable = new BrowserError(
          'browser_unavailable',
          'O navegador encerrou durante a ação.',
          {
            reason: 'browser_crashed',
            uncertain: true,
          },
        );
        return {
          sessionId: record.id,
          ...toFailure(unavailable, (text) => context.redact(text)),
          decisions,
        };
      }
      return {
        sessionId: record.id,
        ...toFailure(failure, (text) => context.redact(text)),
        decisions,
      };
    }
  }

  /** A failed or 403 navigation whose origin the proxy denied is a policy denial. */
  private explain(error: unknown, command: Command, decisions: DecisionRecord[]) {
    if (!(error instanceof BrowserError) || command.action !== 'browserNavigate') return error;
    if (error.code !== 'navigation_failed' && error.code !== 'navigation_denied') return error;
    const denials = decisions.filter((decision) => !decision.allowed);
    if (!denials.length) return error;
    let origin = '';
    try {
      const url = new URL(command.url);
      origin =
        url.protocol === 'https:'
          ? formatOrigin('tunnel', url.hostname.replace(/^\[|\]$/g, ''), Number(url.port || 443))
          : formatOrigin('http', url.hostname.replace(/^\[|\]$/g, ''), Number(url.port || 80));
    } catch {
      origin = '';
    }
    const decision = denials.find((item) => item.origin === origin) ?? denials.at(-1)!;
    if (
      error.code === 'navigation_failed' &&
      decision.origin !== origin &&
      !/TUNNEL|PROXY|403/i.test(String(error.details.reason))
    )
      return error;
    return new BrowserError('navigation_denied', 'Destino bloqueado pela política de rede.', {
      decision: { origin: decision.origin, rule: decision.rule, code: decision.code },
    });
  }

  private async perform(env: Env, session: BrowserSession, command: SessionCommand) {
    switch (command.action) {
      case 'browserNavigate':
        return session.navigate(command.url, command.waitUntil, command.timeoutMs);
      case 'browserSnapshot':
        return session.snapshot(command.maxText, command.maxElements, command.full);
      case 'browserClick':
        return session.click(command.ref, command.snapshotId, command.timeoutMs);
      case 'browserFill': {
        let value = command.value;
        if (command.credential) {
          if (session.record.kind !== 'test')
            throw new BrowserError(
              'credential_not_allowed',
              'Credenciais de teste só podem ser usadas em sessões de teste.',
            );
          const project = env.base.workspaces.project(session.record.projectId);
          const stored =
            project.programming?.browser?.credentials.includes(command.credential.name) &&
            env.store.credential(session.record.projectId, command.credential.name);
          if (!stored)
            throw new BrowserError(
              'credential_not_found',
              'Credencial de teste não encontrada ou não habilitada no projeto.',
            );
          value = stored[command.credential.field];
        }
        return session.fill(command.ref, command.snapshotId, value ?? '', {
          ...(command.credential && { credential: command.credential }),
          submit: command.submit,
          timeoutMs: command.timeoutMs,
        });
      }
      case 'browserWait':
        return session.wait(command);
      case 'browserScreenshot':
        return session.screenshot(command.fullPage, command.viewport);
      case 'browserDiagnostics':
        return session.diagnostics(command.limit);
      default:
        throw new BrowserError('forbidden', 'Ação de browser desconhecida.');
    }
  }

  private async closeSession(
    env: Env,
    command: Extract<Command, { action: 'browserClose' }>,
    context: RunnerContext,
  ) {
    const record = this.owned(env, command, context);
    if (!record) throw new BrowserError('session_not_found', 'Sessão não encontrada.');
    if (record.state !== 'active' || !this.sessions.has(record.id))
      return { sessionId: record.id, closed: true, state: record.state, alreadyClosed: true };
    const reason = context.botId ? 'closed' : 'admin_closed';
    const decisions = await this.end(record.id, 'closed', reason);
    return {
      sessionId: record.id,
      closed: true,
      state: 'closed',
      reason,
      durationMs: Date.now() - Date.parse(record.createdAt),
      decisions,
    };
  }

  /** Closes the context (its cookies, storage and cache go with it) and records why. */
  private async end(
    sessionId: string,
    state: SessionState,
    reason: string,
  ): Promise<DecisionRecord[]> {
    const env = this.env;
    const session = this.sessions.get(sessionId);
    if (!env || !session) return [];
    this.sessions.delete(sessionId);
    const decisions = env.proxy.decisions(sessionId);
    env.proxy.unregister(sessionId);
    const record = env.store.session(sessionId) ?? session.record;
    env.store.saveSession({
      ...record,
      state,
      closedAt: new Date().toISOString(),
      ...(state === 'failed' ? { code: reason } : { reason }),
    });
    await session.close();
    this.idle();
    return decisions;
  }

  /** Browser crashed: every live session is failed and its proxy access ends. */
  private failAll(code: string) {
    const env = this.env;
    if (!env) return;
    for (const [id, session] of this.sessions) {
      this.sessions.delete(id);
      env.proxy.unregister(id);
      env.store.saveSession({
        ...session.record,
        state: 'failed',
        code,
        closedAt: new Date().toISOString(),
      });
    }
    env.store.failActiveSessions(code);
  }

  private idle() {
    if (this.sessions.size || !this.env) return;
    clearTimeout(this.idleTimer);
    const runtime = this.env.runtime;
    this.idleTimer = setTimeout(
      () => {
        if (!this.sessions.size) void runtime.stop();
      },
      this.options.idleMs ?? envMs('OINKO_BROWSER_IDLE_MS') ?? 600_000,
    );
    this.idleTimer.unref();
  }

  private sweep() {
    if (this.sweeper) return;
    const limit = this.options.sessionIdleMs ?? envMs('OINKO_BROWSER_SESSION_IDLE_MS') ?? 1_200_000;
    this.sweeper = setInterval(
      () => {
        for (const [id, session] of this.sessions)
          if (Date.now() - session.lastUsed > limit) void this.end(id, 'expired', 'idle_timeout');
      },
      Math.min(60_000, Math.max(1000, Math.floor(limit / 4))),
    );
    this.sweeper.unref();
  }

  async recover(context: BaseContext) {
    // Nothing to reconcile in a root that never used the browser.
    const used =
      existsSync(join(context.root, '.harness/browser.db')) ||
      existsSync(join(context.root, '.harness/runtime/browser'));
    if (!used) return;
    const env = this.setup(context);
    env.store.failActiveSessions('runner_restarted');
    await env.runtime.removeOrphans().catch(() => undefined);
  }

  async close() {
    clearTimeout(this.idleTimer);
    clearInterval(this.sweeper);
    const env = this.env;
    if (!env) return;
    this.env = undefined;
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions)
      env.store.saveSession({
        ...session.record,
        state: 'closed',
        reason: 'runner_stopped',
        closedAt: new Date().toISOString(),
      });
    env.store.close();
    // The runner may exit right after close(): remove containers synchronously.
    if (env.runtime.state !== 'stopped') {
      const envVars: NodeJS.ProcessEnv = {};
      for (const key of [
        'PATH',
        'HOME',
        'DOCKER_HOST',
        'DOCKER_CONTEXT',
        'DOCKER_CONFIG',
        'DOCKER_CERT_PATH',
        'DOCKER_TLS_VERIFY',
      ])
        if (process.env[key]) envVars[key] = process.env[key];
      const { browser, relay, internal, egress } = env.runtime.names;
      spawnSync('docker', ['rm', '-f', browser, relay], {
        env: envVars,
        stdio: 'ignore',
        timeout: 30_000,
      });
      spawnSync('docker', ['network', 'rm', internal, egress], {
        env: envVars,
        stdio: 'ignore',
        timeout: 30_000,
      });
    }
    await Promise.all(sessions.map((session) => session.close()));
    await env.proxy.close();
  }
}
