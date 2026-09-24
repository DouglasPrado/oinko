import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserContext, ElementHandle, Page, Request, Response } from 'playwright-core';
import { BrowserError } from './errors.js';
import type { PreviewMatch } from './policy.js';
import type { Redactor } from './redact.js';
import {
  RefTable,
  fingerprintScript,
  fullTextScript,
  markCredentialScript,
  snapshotScript,
  type SnapshotData,
} from './snapshot.js';
import type { SessionRecord } from './store.js';

export interface ConsoleEntry {
  level: 'error' | 'assert' | 'pageerror';
  text: string;
  url?: string;
  at: string;
}
export interface NetworkEntry {
  method: string;
  url: string;
  origin: string;
  /** 0 when the request failed without a response. */
  status: number;
  failure?: string;
  resourceType: string;
  /** Egress policy code when the proxy refused the request. */
  policy?: string;
  at: string;
}
interface Artifact {
  mediaType: string;
  encoding: 'base64';
  data: string;
  bytes: number;
  sha256: string;
  truncated?: boolean;
}
export interface SessionDeps {
  redactor: () => Redactor;
  previewFor: (url: string) => PreviewMatch | undefined;
}

/** Keeps responses below the runner client's 2 MB limit after base64. */
const MAX_ARTIFACT_BYTES = 1_000_000;
const MAX_ENTRIES = 200;
const ACTION_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 5000;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function isTimeout(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || /Timeout \d+ms exceeded/.test(error.message))
  );
}
function netError(text: string) {
  return /net::ERR_[A-Z_]+/.exec(text)?.[0] ?? text.split('\n')[0]!.slice(0, 200);
}
function artifactOf(data: Buffer, mediaType: string, truncated = false): Artifact {
  return {
    mediaType,
    encoding: 'base64',
    data: data.toString('base64'),
    bytes: data.length,
    sha256: `sha256:${createHash('sha256').update(data).digest('hex')}`,
    ...(truncated && { truncated: true }),
  };
}
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new BrowserError('action_timeout', `${what} excedeu ${ms} ms.`, { uncertain: false }),
            ),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One isolated BrowserContext (cookies, storage, cache and permissions of its
 * own; downloads refused) bound to a bot, run, project and kind. Actions are
 * serialized; each returns a short observation and never unbounded HTML.
 */
export class BrowserSession {
  lastUsed = Date.now();
  private page: Page;
  private navigation = 0;
  private redactor: Redactor;
  private readonly refs = new RefTable<ElementHandle>((handles) => {
    for (const handle of handles) void handle.dispose().catch(() => {});
  });
  private consoleEntries: ConsoleEntry[] = [];
  private networkEntries: NetworkEntry[] = [];
  private dropped = { console: 0, network: 0 };
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly record: SessionRecord,
    readonly context: BrowserContext,
    page: Page,
    private readonly deps: SessionDeps,
  ) {
    this.page = page;
    this.redactor = deps.redactor();
    context.setDefaultTimeout(ACTION_TIMEOUT_MS);
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    this.watch(page);
    // A popup becomes the active page; refs of the previous page are stale.
    context.on('page', (next) => {
      this.page = next;
      this.navigation++;
      this.refs.clear();
      this.watch(next);
    });
    context.on('console', (entry) => {
      const level = entry.type();
      if (level !== 'error' && level !== 'assert') return;
      this.push(this.consoleEntries, 'console', {
        level,
        text: this.redactor.text(entry.text(), 1000),
        ...(entry.location().url && { url: this.redactor.url(entry.location().url) }),
        at: new Date().toISOString(),
      });
    });
    context.on('weberror', (webError) => {
      const error = webError.error();
      this.push(this.consoleEntries, 'console', {
        level: 'pageerror',
        text: this.redactor.text(`${error.name}: ${error.message}`, 1000),
        at: new Date().toISOString(),
      });
    });
    context.on('requestfailed', (request) => {
      const failure = request.failure()?.errorText ?? 'failed';
      if (/ERR_ABORTED/.test(failure) || !/^https?:/.test(request.url())) return;
      this.push(this.networkEntries, 'network', {
        ...this.describeRequest(request),
        status: 0,
        failure: netError(failure),
      });
    });
    context.on('response', (response) => {
      const status = response.status();
      if (status < 400) return;
      const policy = /code=([a-z_]+)/.exec(response.headers()['x-oinko-policy'] ?? '')?.[1];
      this.push(this.networkEntries, 'network', {
        ...this.describeRequest(response.request()),
        status,
        ...(policy && { policy }),
      });
    });
  }

  private watch(page: Page) {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.navigation++;
    });
  }

  private describeRequest(request: Request) {
    return {
      method: request.method(),
      url: this.redactor.url(request.url()),
      origin: this.redactor.origin(request.url()),
      resourceType: request.resourceType(),
      at: new Date().toISOString(),
    };
  }

  private push<T>(list: T[], kind: 'console' | 'network', entry: T) {
    if (list.length >= MAX_ENTRIES) {
      list.shift();
      this.dropped[kind]++;
    }
    list.push(entry);
  }

  /** Serializes actions of this session and refreshes the redactor. */
  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      this.lastUsed = Date.now();
      this.redactor = this.deps.redactor();
      return action();
    });
    this.queue = next.catch(() => {});
    return next.finally(() => (this.lastUsed = Date.now()));
  }

  private async observe() {
    // A page in the middle of navigating may not answer; the title is optional.
    const title = await within(this.page.title(), 5000, 'Leitura do título').catch(() => '');
    const url = this.page.url();
    const preview = this.deps.previewFor(url);
    return {
      url: this.redactor.url(url),
      title: this.redactor.text(title, 300),
      ...(preview && { preview }),
    };
  }

  /** Tracks navigation and non-GET requests an action starts, to report uncertainty. */
  private activity() {
    const page = this.page;
    const start = this.navigation;
    const pending = new Set<Request>();
    let navigating = false;
    const onRequest = (request: Request) => {
      const navigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
      if (navigation) navigating = true;
      if (navigation || request.method() !== 'GET') pending.add(request);
    };
    const onDone = (request: Request) => pending.delete(request);
    page.on('request', onRequest);
    page.on('requestfinished', onDone);
    page.on('requestfailed', onDone);
    return {
      settle: async (ms: number) => {
        const deadline = Date.now() + ms;
        await delay(Math.min(200, ms));
        while (pending.size && Date.now() < deadline) await delay(50);
        if (navigating && Date.now() < deadline)
          await page
            .waitForLoadState('domcontentloaded', { timeout: Math.max(1, deadline - Date.now()) })
            .catch(() => {});
        page.off('request', onRequest);
        page.off('requestfinished', onDone);
        page.off('requestfailed', onDone);
        return {
          navigated: this.navigation !== start,
          pendingRequests: pending.size,
          uncertain: pending.size > 0,
        };
      },
    };
  }

  private async target(ref: string, snapshotId: string | undefined) {
    const found = this.refs.lookup({
      ref,
      snapshotId,
      page: this.page,
      navigation: this.navigation,
    });
    let live: { connected: boolean; fingerprint: string };
    try {
      live = await within(
        found.handle.evaluate(fingerprintScript),
        5000,
        'Verificação do elemento',
      );
    } catch {
      live = { connected: false, fingerprint: '' };
    }
    RefTable.verify(found, live);
    return found.handle;
  }

  private actionError(error: unknown, uncertain: boolean): BrowserError {
    if (error instanceof BrowserError) return error;
    if (isTimeout(error))
      return new BrowserError('action_timeout', 'A ação excedeu o tempo limite.', { uncertain });
    if (/not attached|detached|Execution context was destroyed/i.test(message(error)))
      return new BrowserError('stale_element', 'O elemento saiu da página. Faça um novo snapshot.');
    return new BrowserError(
      'action_failed',
      `A ação falhou: ${this.redactor.text(message(error).split('\n')[0]!, 400)}`,
      { uncertain },
    );
  }

  async navigate(
    url: string,
    waitUntil: 'commit' | 'domcontentloaded' | 'load' | 'networkidle',
    timeoutMs?: number,
  ) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new BrowserError('invalid_url', 'Informe uma URL absoluta http(s).');
    }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password)
      throw new BrowserError('invalid_url', 'Somente URLs http(s) sem credenciais são navegáveis.');
    let response: Response | null;
    try {
      response = await this.page.goto(target.toString(), {
        waitUntil,
        timeout: timeoutMs ?? NAVIGATION_TIMEOUT_MS,
      });
    } catch (error) {
      const text = message(error);
      throw new BrowserError(
        'navigation_failed',
        isTimeout(error)
          ? 'A navegação excedeu o tempo limite.'
          : `Falha na navegação: ${this.redactor.text(netError(text), 200)}`,
        {
          reason: isTimeout(error) ? 'timeout' : netError(text),
          url: this.redactor.url(this.page.url()),
          // The document may have committed partially: its state is not known.
          uncertain: isTimeout(error),
        },
      );
    }
    const policy = response?.headers()['x-oinko-policy'];
    if (policy)
      throw new BrowserError('navigation_denied', 'Destino bloqueado pela política de rede.', {
        policy: /code=([a-z_]+)/.exec(policy)?.[1] ?? 'denied',
        status: response?.status(),
      });
    return {
      ...(await this.observe()),
      status: response?.status() ?? null,
      ok: response?.ok() ?? false,
      redirected: !!response?.request().redirectedFrom(),
    };
  }

  async snapshot(maxText: number, maxElements: number, full: 'none' | 'text' | 'html') {
    const page = this.page;
    const navigation = this.navigation;
    const handle = await within(
      page.evaluateHandle(snapshotScript, { maxText, maxElements }),
      15_000,
      'Snapshot',
    );
    let data: SnapshotData;
    let handles: ElementHandle[];
    try {
      data = (await (await handle.getProperty('data')).jsonValue()) as SnapshotData;
      const nodes = await handle.getProperty('nodes');
      const properties = await nodes.getProperties();
      handles = [...properties.entries()]
        .filter(([key]) => /^\d+$/.test(key))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, value]) => value.asElement()!)
        .filter(Boolean);
      await nodes.dispose();
    } finally {
      await handle.dispose().catch(() => {});
    }
    const snapshotId = this.refs.bind({
      page,
      navigation,
      handles,
      fingerprints: data.fingerprints,
    });
    const r = this.redactor;
    let artifact: Artifact | undefined;
    if (full !== 'none') {
      const content =
        full === 'text'
          ? await within(page.evaluate(fullTextScript), 15_000, 'Leitura')
          : await page.content();
      const redacted = r.text(content, MAX_ARTIFACT_BYTES);
      const bytes = Buffer.from(redacted, 'utf8').subarray(0, MAX_ARTIFACT_BYTES);
      artifact = artifactOf(
        bytes,
        full === 'text' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8',
        redacted.length < content.length || bytes.length >= MAX_ARTIFACT_BYTES,
      );
    }
    const preview = this.deps.previewFor(data.url);
    return {
      snapshotId,
      url: r.url(data.url),
      title: r.text(data.title, 300),
      text: r.text(data.text, maxText + 40),
      textLength: data.textLength,
      textTruncated: data.textLength > data.text.length,
      elements: data.elements.map((element) => ({
        ...element,
        name: r.text(element.name, 160),
        ...(element.value !== undefined && { value: r.text(element.value, 200) }),
        ...(element.href !== undefined && { href: r.url(element.href) }),
      })),
      totalElements: data.totalElements,
      elementsTruncated: data.totalElements > data.elements.length,
      ...(preview && { preview }),
      ...(artifact && { artifact }),
    };
  }

  async click(ref: string, snapshotId: string | undefined, timeoutMs = ACTION_TIMEOUT_MS) {
    const handle = await this.target(ref, snapshotId);
    const watch = this.activity();
    try {
      // Dispatch only; the activity tracker decides whether the effect is still uncertain.
      await handle.click({ timeout: timeoutMs, noWaitAfter: true });
    } catch (error) {
      const settled = await watch.settle(500);
      throw this.actionError(error, settled.uncertain || settled.navigated);
    }
    const settled = await watch.settle(Math.min(timeoutMs, SETTLE_MS));
    return { ref, ...settled, ...(await this.observe()) };
  }

  async fill(
    ref: string,
    snapshotId: string | undefined,
    value: string,
    options: {
      credential?: { name: string; field: 'username' | 'password' };
      submit: boolean;
      timeoutMs?: number;
    },
  ) {
    const timeout = options.timeoutMs ?? ACTION_TIMEOUT_MS;
    const handle = await this.target(ref, snapshotId);
    try {
      await handle.fill(value, { timeout });
      if (options.credential) await handle.evaluate(markCredentialScript, options.credential.name);
    } catch (error) {
      throw this.actionError(error, false);
    }
    const base = {
      ref,
      filled: true,
      ...(options.credential && {
        credential: options.credential.name,
        field: options.credential.field,
      }),
    };
    if (!options.submit) return { ...base, ...(await this.observe()) };
    const watch = this.activity();
    try {
      await handle.press('Enter', { timeout, noWaitAfter: true });
    } catch (error) {
      const settled = await watch.settle(500);
      throw this.actionError(error, settled.uncertain || settled.navigated);
    }
    const settled = await watch.settle(Math.min(timeout, SETTLE_MS));
    return { ...base, submitted: true, ...settled, ...(await this.observe()) };
  }

  async wait(input: { text?: string; selector?: string; ms?: number; timeoutMs?: number }) {
    const started = Date.now();
    const timeout = input.timeoutMs ?? ACTION_TIMEOUT_MS;
    try {
      if (input.ms !== undefined) await delay(input.ms);
      else if (input.text !== undefined)
        await this.page.getByText(input.text).first().waitFor({ state: 'visible', timeout });
      else await this.page.locator(input.selector!).first().waitFor({ state: 'visible', timeout });
    } catch (error) {
      if (isTimeout(error))
        throw new BrowserError(
          'action_timeout',
          'A condição não apareceu dentro do tempo limite.',
          {
            matched: false,
            waitedMs: Date.now() - started,
            uncertain: false,
          },
        );
      throw this.actionError(error, false);
    }
    return { matched: true, waitedMs: Date.now() - started, ...(await this.observe()) };
  }

  async screenshot(fullPage: boolean, viewport?: { width: number; height: number }) {
    const page = this.page;
    if (viewport) await page.setViewportSize(viewport);
    const mask = [page.locator('[data-oinko-credential]'), page.locator('input[type=password]')];
    const shot = (type: 'png' | 'jpeg', full: boolean) =>
      page.screenshot({
        type,
        fullPage: full,
        mask,
        animations: 'disabled',
        caret: 'hide',
        timeout: 30_000,
        ...(type === 'jpeg' && { quality: 70 }),
      });
    let buffer = await shot('png', fullPage);
    let mediaType = 'image/png';
    let captured = fullPage;
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      buffer = await shot('jpeg', fullPage);
      mediaType = 'image/jpeg';
    }
    if (buffer.length > MAX_ARTIFACT_BYTES && fullPage) {
      buffer = await shot('jpeg', false);
      captured = false;
    }
    if (buffer.length > MAX_ARTIFACT_BYTES)
      throw new BrowserError(
        'artifact_too_large',
        'A captura excede o limite de artefato mesmo comprimida.',
        {
          bytes: buffer.length,
        },
      );
    return {
      artifact: artifactOf(buffer, mediaType, fullPage && !captured),
      fullPage: captured,
      viewport: page.viewportSize(),
      ...(await this.observe()),
    };
  }

  diagnostics(limit: number) {
    const consoleEntries = this.consoleEntries;
    const networkEntries = this.networkEntries;
    const dropped = {
      console: this.dropped.console + Math.max(0, consoleEntries.length - limit),
      network: this.dropped.network + Math.max(0, networkEntries.length - limit),
    };
    this.consoleEntries = [];
    this.networkEntries = [];
    this.dropped = { console: 0, network: 0 };
    return {
      console: consoleEntries.slice(-limit),
      network: networkEntries.slice(-limit),
      dropped,
    };
  }

  /** Counts for status without draining. */
  get pending() {
    return { console: this.consoleEntries.length, network: this.networkEntries.length };
  }

  async close() {
    this.refs.clear();
    await this.context.close().catch(() => {});
  }
}
