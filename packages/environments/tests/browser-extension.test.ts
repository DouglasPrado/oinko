import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentController } from '../src/runtime/controller.js';
import { RunnerCommand } from '../src/contracts/requests.js';
import { browserSeccompProfile, sandboxVerdict } from '../src/browser/container.js';
import { BROWSER_ERROR_CODES } from '../src/browser/errors.js';

type Result = { error?: { code: string; message: string; retryable: boolean } } & Record<
  string,
  unknown
>;

describe('BrowserExtension through the runner controller (no Docker)', () => {
  let root: string;
  let controller: EnvironmentController;
  const call = (command: unknown, botId?: string, correlation?: Record<string, string>) =>
    controller.handle({ command, botId, correlation }) as Promise<Result>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'oinko-browser-ext-'));
    controller = new EnvironmentController(root);
    await controller.recover();
    const project = (id: string, enabled: boolean) => ({
      id,
      name: id,
      repositories: [{ id: 'app', source: 'https://example.com/app.git' }],
      allowedBotIds: ['coder'],
      programming: { browser: { enabled, credentials: ['admin'] } },
    });
    await call({ action: 'saveProject', definition: project('shop', true), revision: 0 });
    await call({ action: 'saveProject', definition: project('closed', false), revision: 0 });
  });
  afterEach(async () => {
    controller.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('never touches Docker or creates browser files in a root that never used the browser', async () => {
    expect(() => readFileSync(join(root, '.harness/browser.db'))).toThrow();
    const status = await call({ action: 'browserStatus' });
    expect(status).toMatchObject({
      state: 'stopped',
      available: false,
      baseImage: 'mcr.microsoft.com/playwright:v1.63.0-noble',
      playwrightVersion: '1.63.0',
      sandbox: 'unverified',
      sessions: [],
    });
  });

  it('keeps test credentials admin-only and never returns their values', async () => {
    const save = {
      action: 'browserSaveCredential',
      projectId: 'shop',
      name: 'admin',
      username: 'qa-login@example.com',
      password: 'Planted-Browser-Secret-7',
    };
    expect((await call(save, 'coder')).error?.code).toBe('forbidden');
    const saved = await call(save);
    expect(saved).toMatchObject({ projectId: 'shop', name: 'admin' });
    expect((await call({ ...save, projectId: 'missing' })).error?.code).toBe('forbidden');
    const listed = await call({ action: 'browserCredentials', projectId: 'shop' });
    expect(listed).toEqual({
      projectId: 'shop',
      credentials: [{ name: 'admin', updatedAt: expect.any(String) }],
    });
    expect(
      (await call({ action: 'browserCredentials', projectId: 'shop' }, 'coder')).error?.code,
    ).toBe('forbidden');
    const everything = JSON.stringify([
      saved,
      listed,
      await call({ action: 'browserStatus' }),
      await call({ action: 'state' }),
    ]);
    for (const value of ['qa-login@example.com', 'Planted-Browser-Secret-7'])
      expect(everything).not.toContain(value);
    controller.close();
    const db = readFileSync(join(root, '.harness/browser.db'));
    expect(db.includes(Buffer.from('Planted-Browser-Secret-7'))).toBe(false);
    controller = new EnvironmentController(root);
    expect(
      await call({ action: 'browserDeleteCredential', projectId: 'shop', name: 'admin' }),
    ).toMatchObject({ deleted: true });
  });

  it('binds sessions to a bot and a run and refuses callers without them, before starting a browser', async () => {
    const session = { action: 'browserSession', projectId: 'shop', kind: 'test' };
    expect((await call(session)).error?.code).toBe('forbidden');
    expect((await call(session, 'coder')).error?.code).toBe('run_required');
    expect(
      (await call({ ...session, runId: 'run-a' }, 'coder', { runId: 'run-b' })).error?.code,
    ).toBe('run_mismatch');
    // Unknown project and unauthorized bot get the same answer.
    const intruder = await call({ ...session, runId: 'run-a' }, 'intruder');
    const missing = await call({ ...session, projectId: 'nope', runId: 'run-a' }, 'coder');
    expect(intruder.error).toMatchObject({ code: 'forbidden' });
    expect(missing.error).toEqual(intruder.error);
    expect(
      (await call({ ...session, projectId: 'closed', runId: 'run-a' }, 'coder')).error?.code,
    ).toBe('browser_disabled');
    expect((await call({ action: 'browserStatus' })).state).toBe('stopped');
  });

  it('answers guessed session IDs like unknown ones and keeps admins to inspection', async () => {
    const guessed = 'bs-0123456789abcdef01234567';
    for (const action of [
      'browserNavigate',
      'browserSnapshot',
      'browserDiagnostics',
      'browserClose',
    ]) {
      const command = { action, sessionId: guessed, runId: 'run-a', url: 'https://example.com/' };
      expect((await call(command, 'coder')).error?.code).toBe('session_not_found');
    }
    expect(
      (await call({ action: 'browserNavigate', sessionId: guessed, url: 'https://example.com/' }))
        .error?.code,
    ).toBe('forbidden');
    expect((await call({ action: 'browserClose', sessionId: guessed })).error?.code).toBe(
      'session_not_found',
    );
    expect((await call({ action: 'browserStatus', sessionId: guessed }, 'coder')).error?.code).toBe(
      'session_not_found',
    );
  });

  it('reports an unreachable Docker daemon as browser_unavailable, never as a passed check', async () => {
    const previous = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = 'unix:///nonexistent/oinko-browser-test.sock';
    try {
      const result = await call(
        { action: 'browserSession', projectId: 'shop', kind: 'test', runId: 'run-a' },
        'coder',
      );
      expect(result.error).toMatchObject({
        code: 'browser_unavailable',
        reason: 'docker_unavailable',
        retryable: true,
      });
      expect(result.sessionId).toBeUndefined();
      expect(await call({ action: 'browserStatus' })).toMatchObject({
        state: 'failed',
        available: false,
        lastError: { reason: 'docker_unavailable' },
      });
    } finally {
      if (previous === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = previous;
    }
  });

  it('documents every error code it can return', () => {
    for (const code of Object.keys(BROWSER_ERROR_CODES)) expect(code).toMatch(/^[a-z_]+$/);
  });
});

describe('browser command schemas', () => {
  const parse = (command: unknown) => RunnerCommand.safeParse(command).success;
  const session = { sessionId: 'bs-0123456789abcdef01234567' };
  it('requires exactly one value source for fill and one condition for wait', () => {
    expect(parse({ action: 'browserFill', ...session, ref: 'e1', value: 'x' })).toBe(true);
    expect(
      parse({
        action: 'browserFill',
        ...session,
        ref: 'e1',
        credential: { name: 'admin', field: 'password' },
      }),
    ).toBe(true);
    expect(parse({ action: 'browserFill', ...session, ref: 'e1' })).toBe(false);
    expect(
      parse({
        action: 'browserFill',
        ...session,
        ref: 'e1',
        value: 'x',
        credential: { name: 'admin', field: 'password' },
      }),
    ).toBe(false);
    expect(parse({ action: 'browserWait', ...session, text: 'Pronto' })).toBe(true);
    expect(parse({ action: 'browserWait', ...session })).toBe(false);
    expect(parse({ action: 'browserWait', ...session, text: 'a', ms: 10 })).toBe(false);
  });
  it('bounds identifiers, refs, timeouts and viewports', () => {
    expect(parse({ action: 'browserClick', ...session, ref: 'e12' })).toBe(true);
    expect(parse({ action: 'browserClick', ...session, ref: '12' })).toBe(false);
    expect(parse({ action: 'browserClick', sessionId: 'x', ref: 'e1' })).toBe(false);
    expect(parse({ action: 'browserClick', ...session, ref: 'e1', timeoutMs: 600_000 })).toBe(
      false,
    );
    expect(
      parse({ action: 'browserScreenshot', ...session, viewport: { width: 390, height: 844 } }),
    ).toBe(true);
    expect(
      parse({ action: 'browserScreenshot', ...session, viewport: { width: 10, height: 10 } }),
    ).toBe(false);
    expect(
      parse({
        action: 'browserSaveCredential',
        projectId: 'shop',
        name: 'Admin',
        username: 'user',
        password: 'pass',
      }),
    ).toBe(false);
  });
});

describe('Chromium sandbox verification', () => {
  it('adds only chroot to Playwright seccomp profile and keeps the user-namespace rule', () => {
    const profile = browserSeccompProfile();
    const names = profile.syscalls.flatMap((rule) => [...rule.names]);
    expect(names).toEqual(expect.arrayContaining(['clone', 'unshare', 'setns', 'chroot']));
    expect(profile.defaultAction).toBe('SCMP_ACT_ERRNO');
    expect(profile.syscalls.at(-1)).toMatchObject({ names: ['chroot'], action: 'SCMP_ACT_ALLOW' });
  });
  it('accepts renderers in their own user namespace and rejects --no-sandbox or shared namespaces', () => {
    const ok =
      'browser user:[1] 0\nzygote user:[1] 0\nzygote user:[2] 0\nrenderer user:[2] 0\ngpu-process user:[1] 0\n';
    expect(sandboxVerdict(ok)).toEqual({ ok: true });
    expect(sandboxVerdict('browser user:[1] 1\nrenderer user:[2] 0')).toMatchObject({ ok: false });
    expect(sandboxVerdict('browser user:[1] 0\nrenderer user:[1] 0')).toMatchObject({ ok: false });
    expect(sandboxVerdict('browser user:[1] 0')).toMatchObject({ ok: false });
    expect(sandboxVerdict('')).toMatchObject({ ok: false });
  });
});
