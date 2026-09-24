import { createHash, randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Browser } from 'playwright-core';
import type { CommandRunner } from '../contracts/index.js';
import { BrowserError } from './errors.js';
import { PLAYWRIGHT_SECCOMP_PROFILE } from './seccomp-profile.js';

/** playwright-core in the runner and the browser image must be this exact version. */
export const PLAYWRIGHT_VERSION = '1.63.0';
export const BROWSER_BASE_IMAGE = `mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble`;
const SERVER_PORT = 3000;
const RELAY_CONTROL_PORT = 3001;
const RELAY_PROXY_PORT = 3128;
const LIMITS = { cpus: '2', memory: '2g', pids: '1024', shm: '512m', tmp: '768m' };

/**
 * Runs inside the browser container. One Chromium with its sandbox enabled;
 * every request defaults to the relay proxy (without credentials it is
 * refused) and name resolution is disabled except for the relay itself.
 */
const SERVER_SOURCE = String.raw`'use strict';
const { chromium } = require('/opt/oinko/playwright-core');
const version = require('/opt/oinko/playwright-core/package.json').version;
const token = process.env.OINKO_BROWSER_TOKEN || '';
delete process.env.OINKO_BROWSER_TOKEN;
if (!/^[a-f0-9]{32,}$/.test(token)) {
  console.error('OINKO_BROWSER_FAILED token');
  process.exit(2);
}
chromium
  .launchServer({
    host: '0.0.0.0',
    port: ${SERVER_PORT},
    wsPath: '/' + token,
    headless: true,
    chromiumSandbox: true,
    proxy: { server: 'http://relay:${RELAY_PROXY_PORT}' },
    args: [
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE relay',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--webrtc-ip-handling-policy=disable_non_proxied_udp',
      '--disable-quic',
      '--no-pings',
      '--disable-domain-reliability',
    ],
  })
  .then((server) => {
    console.log('OINKO_BROWSER_READY ' + JSON.stringify({ playwright: version }));
    const stop = () => server.close().finally(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  })
  .catch((error) => {
    console.error('OINKO_BROWSER_FAILED ' + String((error && error.message) || error).slice(0, 4000));
    process.exit(1);
  });
`;

/** Forwards exactly two fixed destinations; it never chooses a target. */
const RELAY_SOURCE = String.raw`'use strict';
const net = require('net');
function pipe(port, host, targetPort) {
  const server = net.createServer((client) => {
    const upstream = net.connect({ host, port: targetPort });
    const close = () => { client.destroy(); upstream.destroy(); };
    for (const socket of [client, upstream]) { socket.on('error', close); socket.on('close', close); }
    client.pipe(upstream);
    upstream.pipe(client);
  });
  server.maxConnections = 1024;
  server.listen(port, '0.0.0.0');
}
pipe(${RELAY_PROXY_PORT}, process.env.OINKO_PROXY_HOST, Number(process.env.OINKO_PROXY_PORT));
pipe(${RELAY_CONTROL_PORT}, 'browser', ${SERVER_PORT});
console.log('OINKO_RELAY_READY');
`;

const DOCKERFILE = `FROM ${BROWSER_BASE_IMAGE}
COPY . /opt/oinko
RUN rm -f /opt/oinko/Dockerfile && chmod -R a+rX,go-w /opt/oinko
LABEL io.oinko.browser.playwright="${PLAYWRIGHT_VERSION}"
USER pwuser
WORKDIR /tmp
`;

/**
 * Lists Chromium processes: `<type> <user-namespace> <no-sandbox-flag>`.
 * Zygote children rewrite their title, so their cmdline is one
 * space-separated string: match it as a whole.
 */
const SANDBOX_PROBE = String.raw`for p in /proc/[0-9]*; do
  cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null) || continue
  case "$cmd" in /ms-playwright/*) ;; *) continue ;; esac
  type=browser
  case "$cmd" in *" --type=renderer"*) type=renderer ;; *" --type=zygote"*) type=zygote ;; *" --type="*) type=other ;; esac
  flag=0
  case " $cmd " in *" --no-sandbox "*) flag=1 ;; esac
  printf '%s %s %s\n' "$type" "$(readlink "$p/ns/user" 2>/dev/null)" "$flag"
done`;

/**
 * Docker drops a profile's capability-gated rules when capabilities are
 * dropped, and Chromium's namespace sandbox calls chroot(2) inside the user
 * namespace it creates. The kernel still requires CAP_SYS_CHROOT, which the
 * container never has: only Chromium's own namespace grants it.
 */
export function browserSeccompProfile() {
  return {
    ...PLAYWRIGHT_SECCOMP_PROFILE,
    syscalls: [
      ...PLAYWRIGHT_SECCOMP_PROFILE.syscalls,
      {
        comment: 'oinko: chroot inside the Chromium sandbox user namespace (caps still enforced)',
        names: ['chroot'],
        action: 'SCMP_ACT_ALLOW',
        args: [],
        includes: {},
        excludes: {},
      },
    ],
  };
}

/** Parses the probe output: the sandbox is on when renderers run in their own user namespace. */
export function sandboxVerdict(output: string): { ok: boolean; reason?: string } {
  const rows = output
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row.length >= 2);
  if (rows.some((row) => Number(row[2] ?? 0) > 0))
    return { ok: false, reason: 'Chromium foi iniciado com --no-sandbox.' };
  const browser = rows.find((row) => row[0] === 'browser');
  const renderers = rows.filter((row) => row[0] === 'renderer');
  if (!browser || !renderers.length)
    return { ok: false, reason: 'Não foi possível observar os processos do Chromium.' };
  if (renderers.some((row) => !row[1] || row[1] === browser[1]))
    return { ok: false, reason: 'Renderer sem namespace de usuário próprio (sandbox inativa).' };
  return { ok: true };
}

export type RuntimeState = 'stopped' | 'pulling' | 'building' | 'starting' | 'running' | 'failed';
export interface RuntimeOptions {
  root: string;
  namespace: string;
  run: CommandRunner;
  /** Where the relay reaches the runner's egress proxy. */
  proxy: () => { host: string; port: number };
  onDisconnected: (code: string) => void;
}

const require = createRequire(import.meta.url);
function playwrightPackage() {
  const manifest = require.resolve('playwright-core/package.json');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
  const browsers = JSON.parse(readFileSync(join(dirname(manifest), 'browsers.json'), 'utf8')) as {
    browsers: { name: string; browserVersion?: string }[];
  };
  return {
    directory: dirname(manifest),
    version: pkg.version,
    chromium: browsers.browsers.find((item) => item.name === 'chromium-headless-shell')
      ?.browserVersion,
  };
}

function unavailable(reason: string, message: string, retryable = false) {
  return new BrowserError('browser_unavailable', message, { reason }, retryable);
}

/**
 * The managed browser: one container per runner namespace, started lazily.
 * The browser container sits on an internal network whose only other member
 * is a relay; the relay forwards the browser's proxy traffic to the runner's
 * egress proxy and the runner's control connection to the Playwright server.
 */
export class BrowserRuntime {
  state: RuntimeState = 'stopped';
  lastError?: { reason: string; message: string; at: string };
  image?: string;
  baseDigest?: string;
  chromiumVersion?: string;
  startedAt?: string;
  private browser?: Browser;
  private starting?: Promise<Browser>;
  private pulling?: Promise<void>;
  private stopping = false;
  readonly names: { browser: string; relay: string; internal: string; egress: string };
  constructor(private readonly options: RuntimeOptions) {
    const ns = options.namespace;
    this.names = {
      browser: `${ns}-browser`,
      relay: `${ns}-browser-relay`,
      internal: `${ns}-browser-net`,
      egress: `${ns}-browser-egress`,
    };
  }

  get connected() {
    return !!this.browser?.isConnected();
  }

  async ensure(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.starting ??= this.start().finally(() => (this.starting = undefined));
    return this.starting;
  }

  status() {
    return {
      state: this.state,
      available: this.state === 'running' && this.connected,
      baseImage: BROWSER_BASE_IMAGE,
      ...(this.baseDigest && { baseDigest: this.baseDigest }),
      ...(this.image && { image: this.image }),
      playwrightVersion: PLAYWRIGHT_VERSION,
      ...(this.chromiumVersion && { chromiumVersion: this.chromiumVersion }),
      sandbox: this.state === 'running' ? 'enabled' : 'unverified',
      ...(this.startedAt && { startedAt: this.startedAt }),
      ...(this.lastError && { lastError: this.lastError }),
    };
  }

  private docker(args: string[], timeoutMs = 60_000) {
    return this.options.run('docker', args, { timeoutMs, allowFailure: true });
  }

  private fail(error: BrowserError): never {
    this.state = 'failed';
    this.lastError = {
      reason: String(error.details.reason ?? 'unknown'),
      message: error.message,
      at: new Date().toISOString(),
    };
    throw error;
  }

  private async start(): Promise<Browser> {
    try {
      return await this.boot();
    } catch (error) {
      // Pulling is progress, not a failure: the caller retries later.
      if (error instanceof BrowserError && error.details.reason === 'image_pulling') throw error;
      await this.cleanup().catch(() => {});
      if (error instanceof BrowserError) this.fail(error);
      const text = error instanceof Error ? error.message : 'erro';
      if (/executar docker|ENOENT/i.test(text))
        this.fail(unavailable('docker_unavailable', 'Docker indisponível para o navegador.', true));
      this.fail(
        unavailable(
          'start_failed',
          `Não foi possível iniciar o navegador: ${text}`.slice(0, 1500),
          true,
        ),
      );
    }
  }

  private async boot(): Promise<Browser> {
    const pkg = playwrightPackage();
    if (pkg.version !== PLAYWRIGHT_VERSION)
      throw unavailable(
        'version_mismatch',
        `playwright-core ${pkg.version} não corresponde à imagem ${BROWSER_BASE_IMAGE}.`,
      );
    const base = await this.docker([
      'image',
      'inspect',
      '--format',
      '{{json .RepoDigests}}',
      BROWSER_BASE_IMAGE,
    ]);
    if (base.exitCode !== 0) {
      if (/Cannot connect|daemon|error during connect/i.test(base.stderr))
        throw unavailable('docker_unavailable', 'Docker indisponível para o navegador.', true);
      this.pulling ??= this.pull();
      this.state = 'pulling';
      throw unavailable(
        'image_pulling',
        `Baixando a imagem ${BROWSER_BASE_IMAGE}. Tente novamente em alguns minutos.`,
        true,
      );
    }
    this.baseDigest = (JSON.parse(base.stdout || '[]') as string[])[0];
    this.state = 'building';
    this.image = await this.buildImage(pkg.directory);
    this.state = 'starting';
    await this.cleanup();
    const token = randomBytes(24).toString('hex');
    const port = await this.launch(token);
    const browser = await this.connect(port, token);
    await this.verify(browser, pkg.chromium);
    this.browser = browser;
    this.state = 'running';
    this.startedAt = new Date().toISOString();
    this.lastError = undefined;
    browser.on('disconnected', () => {
      if (this.browser !== browser) return;
      this.browser = undefined;
      if (this.stopping) return;
      this.state = 'failed';
      this.lastError = {
        reason: 'browser_crashed',
        message: 'O navegador encerrou inesperadamente.',
        at: new Date().toISOString(),
      };
      void this.cleanup();
      this.options.onDisconnected('browser_crashed');
    });
    return browser;
  }

  private pull() {
    return this.options
      .run('docker', ['pull', BROWSER_BASE_IMAGE], { timeoutMs: 1_800_000, allowFailure: true })
      .then((result) => {
        if (result.exitCode !== 0) {
          this.state = 'failed';
          this.lastError = {
            reason: 'image_pull_failed',
            message: `Falha ao baixar ${BROWSER_BASE_IMAGE}: ${result.stderr.slice(-500)}`,
            at: new Date().toISOString(),
          };
        } else if (this.state === 'pulling') this.state = 'stopped';
      })
      .finally(() => (this.pulling = undefined));
  }

  /** Derived image: pinned base + the runner's own playwright-core copy + two small scripts. */
  private async buildImage(packageDirectory: string) {
    const hash = createHash('sha256')
      .update(JSON.stringify([DOCKERFILE, SERVER_SOURCE, RELAY_SOURCE, PLAYWRIGHT_VERSION]))
      .digest('hex')
      .slice(0, 12);
    const tag = `oinko-browser:${PLAYWRIGHT_VERSION}-${hash}`;
    if ((await this.docker(['image', 'inspect', tag])).exitCode === 0) return tag;
    const context = join(this.options.root, '.harness/runtime/browser/image');
    rmSync(context, { recursive: true, force: true });
    mkdirSync(context, { recursive: true, mode: 0o700 });
    cpSync(packageDirectory, join(context, 'playwright-core'), {
      recursive: true,
      dereference: true,
      filter: (source) =>
        !source.slice(packageDirectory.length).split(/[\\/]/).includes('node_modules'),
    });
    writeFileSync(join(context, 'Dockerfile'), DOCKERFILE);
    writeFileSync(join(context, 'server.cjs'), SERVER_SOURCE);
    writeFileSync(join(context, 'relay.cjs'), RELAY_SOURCE);
    const build = await this.docker(['build', '--tag', tag, context], 600_000);
    if (build.exitCode !== 0)
      throw unavailable(
        'image_build_failed',
        `Falha ao preparar a imagem do navegador: ${build.stderr.slice(-800)}`,
        true,
      );
    return tag;
  }

  private labels(role: string) {
    return [
      '--label',
      `io.oinko.owner=${this.options.namespace}`,
      '--label',
      `io.oinko.role=${role}`,
    ];
  }

  private async launch(token: string) {
    const directory = join(this.options.root, '.harness/runtime/browser');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const seccomp = join(directory, 'seccomp.json');
    writeFileSync(seccomp, JSON.stringify(browserSeccompProfile()), { mode: 0o600 });
    const must = async (args: string[], what: string) => {
      const result = await this.docker(args);
      if (result.exitCode !== 0)
        throw unavailable('start_failed', `${what}: ${result.stderr.trim().slice(-800)}`, true);
      return result.stdout.trim();
    };
    await must(
      ['network', 'create', '--internal', ...this.labels('browser-network'), this.names.internal],
      'Rede interna do navegador',
    );
    await must(
      ['network', 'create', ...this.labels('browser-network'), this.names.egress],
      'Rede do relay do navegador',
    );
    const common = [
      '--init',
      '--user',
      'pwuser',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--read-only',
      '--restart',
      'no',
    ];
    await must(
      [
        'run',
        '-d',
        '--name',
        this.names.browser,
        ...this.labels('browser'),
        ...common,
        '--security-opt',
        `seccomp=${seccomp}`,
        '--network',
        this.names.internal,
        '--network-alias',
        'browser',
        '--tmpfs',
        `/tmp:rw,nosuid,nodev,size=${LIMITS.tmp}`,
        '--shm-size',
        LIMITS.shm,
        '--cpus',
        LIMITS.cpus,
        '--memory',
        LIMITS.memory,
        '--memory-swap',
        LIMITS.memory,
        '--pids-limit',
        LIMITS.pids,
        '--env',
        'HOME=/tmp',
        '--env',
        `OINKO_BROWSER_TOKEN=${token}`,
        this.image!,
        'node',
        '/opt/oinko/server.cjs',
      ],
      'Container do navegador',
    );
    const proxy = this.options.proxy();
    await must(
      [
        'run',
        '-d',
        '--name',
        this.names.relay,
        ...this.labels('browser-relay'),
        ...common,
        '--network',
        this.names.egress,
        ...(process.platform === 'linux'
          ? ['--add-host', 'host.docker.internal:host-gateway']
          : []),
        '--publish',
        `127.0.0.1::${RELAY_CONTROL_PORT}`,
        '--cpus',
        '0.5',
        '--memory',
        '128m',
        '--pids-limit',
        '64',
        '--env',
        'OINKO_PROXY_HOST=host.docker.internal',
        '--env',
        `OINKO_PROXY_PORT=${proxy.port}`,
        this.image!,
        'node',
        '/opt/oinko/relay.cjs',
      ],
      'Relay do navegador',
    );
    await must(
      ['network', 'connect', '--alias', 'relay', this.names.internal, this.names.relay],
      'Conexão do relay',
    );
    const published = await must(
      ['port', this.names.relay, `${RELAY_CONTROL_PORT}/tcp`],
      'Porta do relay',
    );
    const port = Number(/:(\d+)\s*$/m.exec(published)?.[1]);
    if (!port) throw unavailable('start_failed', 'Porta do relay não publicada.', true);
    return port;
  }

  private async logs(name: string) {
    const result = await this.docker(['logs', '--tail', '40', name], 10_000);
    return `${result.stdout}${result.stderr}`
      .split('\n')
      .filter((line) => !line.startsWith('<launching>'))
      .join('\n')
      .slice(-2000);
  }

  private async connect(port: number, token: string): Promise<Browser> {
    const { chromium } = await import('playwright-core');
    const deadline = Date.now() + 45_000;
    let last = '';
    while (Date.now() < deadline) {
      const running = await this.docker(
        ['inspect', '--format', '{{.State.Running}}', this.names.browser],
        10_000,
      );
      if (running.stdout.trim() !== 'true') {
        const logs = await this.logs(this.names.browser);
        if (/No usable sandbox|sys_chroot|zygote/i.test(logs))
          throw unavailable(
            'sandbox_unavailable',
            `A sandbox do Chromium não pôde ser habilitada; o navegador não será usado sem ela. ${logs.slice(-600)}`,
          );
        throw unavailable(
          'start_failed',
          `O container do navegador encerrou: ${logs.slice(-800)}`,
          true,
        );
      }
      try {
        return await chromium.connect(`ws://127.0.0.1:${port}/${token}`, { timeout: 5000 });
      } catch (error) {
        last = error instanceof Error ? error.message.split('\n')[0]! : String(error);
        await delay(500);
      }
    }
    throw unavailable(
      'start_failed',
      `O servidor do navegador não respondeu: ${last.replaceAll(token, '[redacted]')}`,
      true,
    );
  }

  private async verify(browser: Browser, expectedChromium: string | undefined) {
    this.chromiumVersion = browser.version();
    if (expectedChromium && this.chromiumVersion !== expectedChromium)
      throw unavailable(
        'version_mismatch',
        `Chromium ${this.chromiumVersion} difere do esperado por playwright-core ${PLAYWRIGHT_VERSION} (${expectedChromium}).`,
      );
    const info = await this.docker(
      ['exec', this.names.browser, 'cat', '/ms-playwright/.docker-info'],
      10_000,
    );
    let driver: string | undefined;
    try {
      driver = (JSON.parse(info.stdout) as { driverVersion?: string }).driverVersion;
    } catch {
      driver = undefined;
    }
    if (driver !== PLAYWRIGHT_VERSION)
      throw unavailable(
        'version_mismatch',
        `A imagem do navegador foi gerada para Playwright ${driver ?? 'desconhecido'}, esperado ${PLAYWRIGHT_VERSION}.`,
      );
    // A probe page makes Chromium spawn a renderer whose isolation we can observe.
    const probe = await browser.newContext();
    try {
      const page = await probe.newPage();
      await page.setContent('<p>probe</p>');
      let verdict: { ok: boolean; reason?: string } = { ok: false };
      for (let attempt = 0; attempt < 5 && !verdict.ok; attempt++) {
        const result = await this.docker(
          ['exec', this.names.browser, 'sh', '-c', SANDBOX_PROBE],
          15_000,
        );
        verdict = sandboxVerdict(result.stdout);
        if (!verdict.ok) await delay(300);
      }
      if (!verdict.ok)
        throw unavailable(
          'sandbox_unavailable',
          `A sandbox do Chromium não está ativa: ${verdict.reason} O navegador não será usado sem ela.`,
        );
    } finally {
      await probe.close().catch(() => {});
    }
  }

  /** Removes this namespace's browser containers and networks. */
  async cleanup() {
    await this.docker(['rm', '-f', this.names.browser, this.names.relay], 30_000);
    for (const network of [this.names.internal, this.names.egress])
      await this.docker(['network', 'rm', network], 30_000);
  }

  async stop() {
    this.stopping = true;
    try {
      const browser = this.browser;
      this.browser = undefined;
      await browser?.close().catch(() => {});
      if (this.state !== 'stopped') await this.cleanup();
      if (this.state !== 'pulling') this.state = 'stopped';
    } finally {
      this.stopping = false;
    }
  }

  /** Containers labeled for this namespace that a previous runner left behind. */
  async removeOrphans() {
    const owner = `label=io.oinko.owner=${this.options.namespace}`;
    const ids: string[] = [];
    for (const role of ['browser', 'browser-relay']) {
      const list = await this.docker(
        ['ps', '-aq', '--filter', owner, '--filter', `label=io.oinko.role=${role}`],
        20_000,
      );
      if (list.exitCode === 0) ids.push(...list.stdout.split(/\s+/).filter(Boolean));
    }
    if (ids.length) await this.docker(['rm', '-f', ...ids], 30_000);
    const networks = await this.docker(
      ['network', 'ls', '-q', '--filter', owner, '--filter', 'label=io.oinko.role=browser-network'],
      20_000,
    );
    const networkIds = networks.exitCode === 0 ? networks.stdout.split(/\s+/).filter(Boolean) : [];
    if (networkIds.length) await this.docker(['network', 'rm', ...networkIds], 30_000);
    return { containers: ids.length, networks: networkIds.length };
  }
}
