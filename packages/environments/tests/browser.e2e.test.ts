import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentClient } from '../src/client/index.js';
import type { Environment, Preview } from '../src/contracts/index.js';
import type { RunnerCommandInput } from '../src/contracts/requests.js';
import { runCommand } from '../src/runtime/command.js';
import { RuntimeFixture, eventually, freePort } from './helpers/runtime.js';

type Result = {
  error?: { code: string; message: string; retryable: boolean } & Record<string, unknown>;
} & Record<string, unknown>;
interface Element {
  ref: string;
  role: string;
  name: string;
  type?: string;
  value?: string;
  sensitive?: boolean;
}
const CRED = { username: 'qa-user@example.test', password: 'Cred-Secret-9876' };
const OTHER_CRED = { username: 'blog-tester@example.test', password: 'Blog-Secret-5555' };
const FORM_PASSWORD = 'Senha-De-Form-42';

/** Local site the browser reaches through the egress proxy as an allowed literal-IP origin. */
function site() {
  const hanging = new Set<Socket>();
  const page = (title: string, body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body>${body}</body></html>`;
  const send = (
    res: ServerResponse,
    status: number,
    html: string,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(html);
  };
  const form = async (req: IncomingMessage) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    return new URLSearchParams(body);
  };
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://site');
      const v = url.searchParams.get('v') ?? '';
      switch (url.pathname) {
        case '/set-session':
          return send(
            res,
            200,
            page(
              'set',
              `<p>Sessão criada</p><script>localStorage.setItem('owner', ${JSON.stringify(v)})</script>`,
            ),
            { 'Set-Cookie': `sid=${v}; Path=/; SameSite=Lax` },
          );
        case '/whoami': {
          const owner = /sid=([^;]+)/.exec(req.headers.cookie ?? '')?.[1] ?? 'nenhum';
          return send(
            res,
            200,
            page(
              'whoami',
              `<p>Dono: ${owner}</p><p id="storage"></p><script>document.getElementById('storage').textContent = 'Armazenado: ' + (localStorage.getItem('owner') || 'nada')</script>`,
            ),
          );
        }
        case '/form':
          return send(
            res,
            200,
            page(
              'Cadastro',
              '<form method="post" action="/submit"><label>E-mail <input name="email" type="text"></label><label>Senha <input name="password" type="password"></label><button type="submit">Cadastrar</button></form>',
            ),
          );
        case '/submit': {
          const fields = await form(req);
          if (!fields.get('email')?.includes('@'))
            return send(
              res,
              422,
              page(
                'Erro',
                '<p role="alert">E-mail inválido</p><script>console.error("validation failed Authorization: Bearer leaked-bearer-123")</script>',
              ),
            );
          return send(res, 200, page('Ok', '<p>Cadastro ok</p>'));
        }
        case '/js-error':
          return send(
            res,
            200,
            page(
              'JS',
              "<p>Página com erro</p><script>console.error('intentional console error token=abc123xyz'); setTimeout(() => { throw new Error('boom from page') }, 10)</script>",
            ),
          );
        case '/assets':
          return send(
            res,
            200,
            page(
              'Assets',
              '<p>Recursos</p><img src="/missing.png"><img src="http://169.254.169.254/latest/meta-data/iam.png"><script src="http://10.9.9.9/tracker.js"></script>',
            ),
          );
        case '/redirect-private':
          res.writeHead(302, { Location: 'http://10.255.255.1/admin' });
          return res.end();
        case '/mutate':
          return send(
            res,
            200,
            page(
              'Mutate',
              `<button id="target">Alvo</button><button id="swap" onclick="const b=document.getElementById('target');const n=document.createElement('button');n.id='target';n.textContent='Novo alvo';b.replaceWith(n)">Trocar</button>`,
            ),
          );
        case '/hang-form':
          return send(
            res,
            200,
            page(
              'Hang',
              '<form method="post" action="/hang"><button type="submit">Enviar</button></form>',
            ),
          );
        case '/hang':
          hanging.add(req.socket);
          return;
        case '/login':
          return send(
            res,
            200,
            page(
              'Login',
              '<form method="post" action="/session"><label>Usuário <input name="username" autocomplete="username"></label><label>Senha <input name="password" type="password"></label><button>Entrar</button></form>',
            ),
          );
        case '/session': {
          const fields = await form(req);
          const valid = [CRED, OTHER_CRED].some(
            (cred) =>
              cred.username === fields.get('username') && cred.password === fields.get('password'),
          );
          if (!valid)
            return send(res, 401, page('Login', '<p role="alert">Credenciais inválidas</p>'));
          return send(res, 200, page('Painel', `<p>Bem-vindo, ${fields.get('username')}</p>`), {
            'Set-Cookie': 'auth=ok; Path=/',
          });
        }
        case '/tall':
          return send(
            res,
            200,
            page(
              'Tall',
              '<div style="height:3000px;background:linear-gradient(#fff,#39f)">alto</div>',
            ),
          );
        default:
          return send(res, 404, page('404', 'não encontrado'));
      }
    })();
  });
  return {
    server,
    async start() {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    },
    async stop() {
      for (const socket of hanging) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function png(data: string) {
  const bytes = Buffer.from(data, 'base64');
  return {
    signature: bytes.subarray(0, 8).toString('hex'),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'managed browser (real Docker + Chromium)',
  () => {
    const f = new RuntimeFixture();
    const web = site();
    let origin = '';
    let port = 0;
    const botA = new EnvironmentClient(f.root, 'bot-a');
    const botB = new EnvironmentClient(f.root, 'bot-b');
    /** Every response a test received, to prove secrets never appear in any of them. */
    const seen: string[] = [];
    const call = async (client: EnvironmentClient, command: Record<string, unknown>) => {
      const result = await client.command<Result>(command as RunnerCommandInput);
      seen.push(JSON.stringify(result));
      return result;
    };
    const open = async (
      client: EnvironmentClient,
      runId: string,
      extra: Record<string, unknown> = {},
    ) => {
      const created = await call(client, {
        action: 'browserSession',
        projectId: 'shop',
        kind: 'test',
        runId,
        ...extra,
      });
      expect(created.error, JSON.stringify(created.error)).toBeUndefined();
      const sessionId = created.sessionId as string;
      return {
        sessionId,
        created,
        act: (command: Record<string, unknown>) => call(client, { ...command, sessionId, runId }),
      };
    };
    const find = (snapshot: Result, name: string | RegExp) => {
      const element = (snapshot.elements as Element[]).find((item) =>
        typeof name === 'string' ? item.name === name : name.test(item.name),
      );
      if (!element)
        throw new Error(`No element ${String(name)} in ${JSON.stringify(snapshot.elements)}`);
      return element;
    };
    const saveProject = async (
      id: string,
      allowedBotIds: string[],
      credentials: string[] = ['qa'],
    ) => {
      const previous = (await f.client.state()).projects.find((project) => project.id === id);
      return f.client.command({
        action: 'saveProject',
        definition: {
          id,
          name: id,
          repositories: [{ id: 'app', source: 'https://example.com/app.git' }],
          allowedBotIds,
          programming: {
            browser: { enabled: true, allowedOrigins: [origin], publicDocs: true, credentials },
          },
        },
        revision: previous?.revision ?? 0,
      });
    };
    let a: Awaited<ReturnType<typeof open>>;

    beforeAll(async () => {
      origin = await web.start();
      port = Number(new URL(origin).port);
      await f.start();
      await saveProject('shop', ['bot-a', 'bot-b']);
    }, 60_000);
    afterAll(async () => {
      await f.cleanup();
      await web.stop();
    }, 120_000);

    it('starts the pinned image non-root with the Chromium sandbox, limits and no host access', async () => {
      a = await open(botA, 'run-a');
      expect(a.created).toMatchObject({
        kind: 'test',
        runId: 'run-a',
        projectId: 'shop',
        baseImage: 'mcr.microsoft.com/playwright:v1.63.0-noble',
        playwrightVersion: '1.63.0',
        chromiumVersion: '153.0.8010.12',
        sandbox: 'enabled',
        image: expect.stringMatching(/^oinko-browser:1\.63\.0-[a-f0-9]{12}$/),
      });
      const [browser] = JSON.parse(
        (await runCommand('docker', ['inspect', `${f.namespace}-browser`])).stdout,
      );
      expect(browser.Config.User).toBe('pwuser');
      expect(browser.Config.Labels).toMatchObject({
        'io.oinko.owner': f.namespace,
        'io.oinko.role': 'browser',
      });
      expect(browser.HostConfig).toMatchObject({
        CapDrop: ['ALL'],
        ReadonlyRootfs: true,
        Privileged: false,
        NanoCpus: 2_000_000_000,
        Memory: 2 * 1024 ** 3,
        PidsLimit: 1024,
      });
      expect(browser.HostConfig.SecurityOpt).toEqual(
        expect.arrayContaining(['no-new-privileges', expect.stringMatching(/^seccomp=/)]),
      );
      expect(browser.Mounts).toEqual([]);
      expect(Object.keys(browser.NetworkSettings.Networks)).toEqual([`${f.namespace}-browser-net`]);
      const [network] = JSON.parse(
        (await runCommand('docker', ['network', 'inspect', `${f.namespace}-browser-net`])).stdout,
      );
      expect(network.Internal).toBe(true);
      const [relay] = JSON.parse(
        (await runCommand('docker', ['inspect', `${f.namespace}-browser-relay`])).stdout,
      );
      expect(relay.HostConfig).toMatchObject({
        CapDrop: ['ALL'],
        ReadonlyRootfs: true,
        Privileged: false,
      });
      expect(relay.Mounts).toEqual([]);
      expect(relay.HostConfig.PortBindings['3001/tcp'][0].HostIp).toBe('127.0.0.1');
      // Inside: non-root, no capabilities, no Docker socket or host home, no direct egress.
      const inside = await runCommand(
        'docker',
        [
          'exec',
          `${f.namespace}-browser`,
          'sh',
          '-c',
          `id -u; grep CapEff /proc/self/status; test ! -e /var/run/docker.sock && test ! -e /Users && test ! -e /root/.docker && echo isolated; node -e "Promise.allSettled([fetch('http://1.1.1.1',{signal:AbortSignal.timeout(3000)}),fetch('http://host.docker.internal:${port}',{signal:AbortSignal.timeout(3000)})]).then(r=>console.log(r.map(x=>x.status).join(',')))"`,
        ],
        { allowFailure: true, timeoutMs: 30_000 },
      );
      expect(inside.stdout).toContain('1001\n');
      expect(inside.stdout).toMatch(/CapEff:\s+0000000000000000/);
      expect(inside.stdout).toContain('isolated');
      expect(inside.stdout).toContain('rejected,rejected');
      expect(await call(f.client, { action: 'browserStatus' })).toMatchObject({
        state: 'running',
        available: true,
        sandbox: 'enabled',
      });
    }, 300_000);

    it('isolates cookies and storage between two bots, two runs and the docs context', async () => {
      const b = await open(botB, 'run-b');
      expect(
        (await a.act({ action: 'browserNavigate', url: `${origin}/set-session?v=alpha` })).status,
      ).toBe(200);
      expect(
        (await b.act({ action: 'browserNavigate', url: `${origin}/set-session?v=beta` })).status,
      ).toBe(200);
      const read = async (session: Awaited<ReturnType<typeof open>>) => {
        await session.act({ action: 'browserNavigate', url: `${origin}/whoami` });
        await session.act({ action: 'browserWait', text: 'Armazenado:' });
        return String((await session.act({ action: 'browserSnapshot' })).text);
      };
      expect(await read(a)).toMatch(/Dono: alpha[\s\S]*Armazenado: alpha/);
      expect(await read(b)).toMatch(/Dono: beta[\s\S]*Armazenado: beta/);
      const otherRun = await open(botA, 'run-c');
      expect(await read(otherRun)).toMatch(/Dono: nenhum[\s\S]*Armazenado: nada/);
      const docs = await open(botA, 'run-a', { kind: 'docs' });
      expect(await read(docs)).toMatch(/Dono: nenhum[\s\S]*Armazenado: nada/);
      // Another bot, another run or the admin cannot act on a session.
      const navigate = { action: 'browserNavigate', url: `${origin}/whoami` };
      expect(
        (await call(botB, { ...navigate, sessionId: a.sessionId, runId: 'run-a' })).error?.code,
      ).toBe('session_not_found');
      expect(
        (await call(botA, { ...navigate, sessionId: a.sessionId, runId: 'run-x' })).error?.code,
      ).toBe('session_not_found');
      expect((await call(f.client, { ...navigate, sessionId: a.sessionId })).error?.code).toBe(
        'forbidden',
      );
      const admin = await call(f.client, { action: 'browserStatus' });
      expect((admin.sessions as { botId: string }[]).map((s) => s.botId).sort()).toEqual(
        expect.arrayContaining(['bot-a', 'bot-b']),
      );
      const scoped = await call(botB, { action: 'browserStatus' });
      expect(
        (scoped.sessions as { botId?: string; sessionId: string }[]).every((s) => !s.botId),
      ).toBe(true);
      expect((scoped.sessions as { sessionId: string }[]).map((s) => s.sessionId)).toEqual([
        b.sessionId,
      ]);
      // The admin may end any session (inspection and control, never actions).
      expect(
        await call(f.client, { action: 'browserClose', sessionId: otherRun.sessionId }),
      ).toMatchObject({ closed: true, reason: 'admin_closed' });
      expect((await otherRun.act({ action: 'browserSnapshot' })).error).toMatchObject({
        code: 'session_closed',
        reason: 'admin_closed',
      });
      for (const session of [docs, b])
        expect(await session.act({ action: 'browserClose' })).toMatchObject({
          closed: true,
          state: 'closed',
        });
      expect((await b.act({ action: 'browserSnapshot' })).error?.code).toBe('session_closed');
    }, 120_000);

    it('denies private, metadata, loopback and redirect targets, including subresources', async () => {
      const denied = async (url: string) => {
        const result = await a.act({ action: 'browserNavigate', url });
        expect(result.error?.code, `${url}: ${JSON.stringify(result)}`).toBe('navigation_denied');
        return result.error?.decision as { origin: string; code: string; rule: string };
      };
      expect(await denied('http://10.255.255.1/')).toMatchObject({ code: 'private_address' });
      expect(await denied('http://169.254.169.254/latest/meta-data/')).toMatchObject({
        code: 'metadata_address',
      });
      expect(await denied(`http://[::1]:${port}/`)).toMatchObject({ code: 'private_address' });
      expect(await denied(`http://localhost:${port}/`)).toMatchObject({ code: 'private_address' });
      expect(await denied('https://example.com/')).toMatchObject({
        code: 'not_allowed',
        rule: 'default',
      });
      const redirect = await a.act({
        action: 'browserNavigate',
        url: `${origin}/redirect-private`,
      });
      expect(redirect.error).toMatchObject({
        code: 'navigation_denied',
        decision: { origin: 'http://10.255.255.1', code: 'private_address' },
      });
      expect(redirect.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ origin, allowed: true, rule: 'allowed_origin' }),
          expect.objectContaining({ origin: 'http://10.255.255.1', allowed: false }),
        ]),
      );
      for (const url of ['file:///etc/passwd', 'chrome://version', 'javascript:alert(1)'])
        expect((await a.act({ action: 'browserNavigate', url })).error?.code).toBe('invalid_url');
      await a.act({ action: 'browserDiagnostics' });
      const assets = await a.act({ action: 'browserNavigate', url: `${origin}/assets` });
      expect(assets).toMatchObject({ status: 200, title: 'Assets' });
      await a.act({ action: 'browserWait', ms: 500 });
      const diagnostics = await a.act({ action: 'browserDiagnostics' });
      const network = diagnostics.network as { url: string; status: number; policy?: string }[];
      expect(network).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ url: `${origin}/missing.png`, status: 404 }),
          expect.objectContaining({ status: 403, policy: 'metadata_address' }),
          expect.objectContaining({ status: 403, policy: 'private_address' }),
        ]),
      );
      expect(
        (assets.decisions as { origin: string; allowed: boolean }[]).concat(
          diagnostics.decisions as never,
        ),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ origin: 'http://169.254.169.254', allowed: false }),
        ]),
      );
    }, 120_000);

    it.skipIf(process.env.OINKO_OFFLINE === '1')(
      'lets docs sessions read public documentation while still denying private hosts',
      async () => {
        const docs = await open(botA, 'run-docs', { kind: 'docs' });
        const page = await docs.act({ action: 'browserNavigate', url: 'https://example.com/' });
        expect(page, JSON.stringify(page)).toMatchObject({ status: 200, title: 'Example Domain' });
        expect(page.decisions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              origin: 'https://example.com',
              rule: 'public_docs',
              allowed: true,
            }),
          ]),
        );
        expect(
          (await docs.act({ action: 'browserNavigate', url: 'http://10.0.0.1/' })).error?.code,
        ).toBe('navigation_denied');
        await docs.act({ action: 'browserClose' });
      },
      120_000,
    );

    it('fills and submits a form, surfaces the intentional error and redacts console and network captures', async () => {
      await a.act({ action: 'browserNavigate', url: `${origin}/form` });
      let snapshot = await a.act({ action: 'browserSnapshot' });
      const email = find(snapshot, 'E-mail');
      const password = find(snapshot, 'Senha');
      const submit = find(snapshot, 'Cadastrar');
      expect(password).toMatchObject({ type: 'password', sensitive: true });
      expect(
        await a.act({ action: 'browserFill', ref: email.ref, value: 'sem-arroba' }),
      ).toMatchObject({ filled: true });
      await a.act({ action: 'browserFill', ref: password.ref, value: FORM_PASSWORD });
      const filled = await a.act({ action: 'browserSnapshot' });
      expect(find(filled, 'Senha').value).toBe('[redacted]');
      expect(find(filled, 'E-mail').value).toBe('sem-arroba');
      const clicked = await a.act({ action: 'browserClick', ref: find(filled, 'Cadastrar').ref });
      expect(clicked).toMatchObject({ navigated: true, uncertain: false, title: 'Erro' });
      expect(submit.ref).toBe(find(filled, 'Cadastrar').ref);
      snapshot = await a.act({ action: 'browserSnapshot' });
      expect(snapshot.text).toContain('E-mail inválido');
      const diagnostics = await a.act({ action: 'browserDiagnostics' });
      expect(diagnostics.network).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: 'POST', url: `${origin}/submit`, status: 422 }),
        ]),
      );
      const consoleText = JSON.stringify(diagnostics.console);
      expect(consoleText).toContain('validation failed Authorization: [redacted]');
      expect(consoleText).not.toContain('leaked-bearer-123');

      await a.act({ action: 'browserNavigate', url: `${origin}/js-error` });
      await a.act({ action: 'browserWait', text: 'Página com erro' });
      await a.act({ action: 'browserWait', ms: 300 });
      const errors = await a.act({ action: 'browserDiagnostics' });
      expect(errors.console).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            level: 'pageerror',
            text: expect.stringContaining('boom from page'),
          }),
          expect.objectContaining({
            level: 'error',
            text: expect.stringContaining('token=[redacted]'),
          }),
        ]),
      );
      expect(JSON.stringify(errors)).not.toContain('abc123xyz');
      expect(seen.join('\n')).not.toContain(FORM_PASSWORD);
      const timeout = await a.act({ action: 'browserWait', text: 'nunca aparece', timeoutMs: 500 });
      expect(timeout.error).toMatchObject({ code: 'action_timeout', matched: false });
    }, 120_000);

    it('requires a fresh snapshot for stale refs and never acts on old positions', async () => {
      const fresh = await open(botA, 'run-stale');
      expect((await fresh.act({ action: 'browserClick', ref: 'e1' })).error?.code).toBe(
        'snapshot_required',
      );
      await fresh.act({ action: 'browserClose' });
      await a.act({ action: 'browserNavigate', url: `${origin}/mutate` });
      const first = await a.act({ action: 'browserSnapshot' });
      const target = find(first, 'Alvo');
      expect(await a.act({ action: 'browserClick', ref: find(first, 'Trocar').ref })).toMatchObject(
        {
          navigated: false,
        },
      );
      expect((await a.act({ action: 'browserClick', ref: target.ref })).error?.code).toBe(
        'stale_element',
      );
      const second = await a.act({ action: 'browserSnapshot' });
      expect(find(second, 'Novo alvo').ref).toBe(target.ref);
      expect(
        (await a.act({ action: 'browserClick', ref: target.ref, snapshotId: first.snapshotId }))
          .error?.code,
      ).toBe('stale_element');
      expect((await a.act({ action: 'browserClick', ref: 'e99' })).error?.code).toBe('invalid_ref');
      await a.act({ action: 'browserNavigate', url: `${origin}/mutate` });
      expect((await a.act({ action: 'browserClick', ref: target.ref })).error?.code).toBe(
        'stale_element',
      );
    }, 120_000);

    it('uses test credentials only in test sessions of their project and keeps them out of every output', async () => {
      expect(
        await call(f.client, {
          action: 'browserSaveCredential',
          projectId: 'shop',
          name: 'qa',
          ...CRED,
        }),
      ).toMatchObject({ projectId: 'shop', name: 'qa' });
      await a.act({ action: 'browserNavigate', url: `${origin}/login` });
      const login = await a.act({ action: 'browserSnapshot' });
      const user = await a.act({
        action: 'browserFill',
        ref: find(login, 'Usuário').ref,
        credential: { name: 'qa', field: 'username' },
      });
      expect(user).toMatchObject({ filled: true, credential: 'qa', field: 'username' });
      const masked = await a.act({ action: 'browserSnapshot' });
      expect(find(masked, 'Usuário').value).toBe('[credential qa]');
      const submitted = await a.act({
        action: 'browserFill',
        ref: find(masked, 'Senha').ref,
        credential: { name: 'qa', field: 'password' },
        submit: true,
      });
      expect(submitted).toMatchObject({
        credential: 'qa',
        submitted: true,
        navigated: true,
        title: 'Painel',
      });
      const welcome = await a.act({ action: 'browserSnapshot' });
      expect(welcome.text).toBe('Bem-vindo, [redacted]');
      expect((await a.act({ action: 'browserScreenshot' })).artifact).toMatchObject({
        mediaType: 'image/png',
      });
      expect(
        (
          await a.act({
            action: 'browserFill',
            ref: 'e1',
            credential: { name: 'missing', field: 'password' },
          })
        ).error?.code,
      ).toBe('credential_not_found');
      const docs = await open(botA, 'run-a', { kind: 'docs' });
      await docs.act({ action: 'browserNavigate', url: `${origin}/login` });
      const docsLogin = await docs.act({ action: 'browserSnapshot' });
      expect(
        (
          await docs.act({
            action: 'browserFill',
            ref: find(docsLogin, 'Usuário').ref,
            credential: { name: 'qa', field: 'username' },
          })
        ).error?.code,
      ).toBe('credential_not_allowed');
      await docs.act({ action: 'browserClose' });

      // A second project with its own credential under the same name: values never cross projects.
      await saveProject('blog', ['bot-b']);
      await call(f.client, {
        action: 'browserSaveCredential',
        projectId: 'blog',
        name: 'qa',
        ...OTHER_CRED,
      });
      const blog = await call(botB, {
        action: 'browserSession',
        projectId: 'blog',
        kind: 'test',
        runId: 'run-blog',
      });
      const act = (command: Record<string, unknown>) =>
        call(botB, { ...command, sessionId: blog.sessionId, runId: 'run-blog' });
      await act({ action: 'browserNavigate', url: `${origin}/login` });
      const blogLogin = await act({ action: 'browserSnapshot' });
      await act({
        action: 'browserFill',
        ref: find(blogLogin, 'Usuário').ref,
        credential: { name: 'qa', field: 'username' },
      });
      await act({
        action: 'browserFill',
        ref: find(blogLogin, 'Senha').ref,
        credential: { name: 'qa', field: 'password' },
        submit: true,
      });
      expect((await act({ action: 'browserSnapshot' })).text).toBe('Bem-vindo, [redacted]');
      await act({ action: 'browserClose' });
      expect(
        (
          await call(botA, {
            action: 'browserSession',
            projectId: 'blog',
            kind: 'test',
            runId: 'x',
          })
        ).error?.code,
      ).toBe('forbidden');
      const everything = seen.join('\n') + readFileSync(join(f.root, 'runner.log'), 'utf8');
      for (const secret of [CRED.username, CRED.password, OTHER_CRED.username, OTHER_CRED.password])
        expect(everything).not.toContain(secret);
      const db = readFileSync(join(f.root, '.harness/browser.db'));
      for (const secret of [CRED.password, OTHER_CRED.password])
        expect(db.includes(Buffer.from(secret))).toBe(false);
    }, 120_000);

    it('captures mobile and full-page screenshots and full content as bounded artifacts', async () => {
      const mobile = await open(botA, 'run-mobile', { mobile: true });
      expect(mobile.created.viewport).toEqual({ width: 390, height: 844 });
      await mobile.act({ action: 'browserNavigate', url: `${origin}/tall` });
      const shot = await mobile.act({ action: 'browserScreenshot' });
      const artifact = shot.artifact as {
        data: string;
        bytes: number;
        sha256: string;
        mediaType: string;
      };
      expect(png(artifact.data)).toEqual({
        signature: '89504e470d0a1a0a',
        width: 390,
        height: 844,
      });
      expect(artifact.sha256).toBe(
        `sha256:${createHash('sha256').update(Buffer.from(artifact.data, 'base64')).digest('hex')}`,
      );
      expect(artifact.bytes).toBeLessThanOrEqual(1_000_000);
      const full = await mobile.act({ action: 'browserScreenshot', fullPage: true });
      expect(full.fullPage).toBe(true);
      expect(png((full.artifact as { data: string }).data).height).toBeGreaterThanOrEqual(3000);
      const html = await mobile.act({ action: 'browserSnapshot', full: 'html', maxText: 10 });
      expect(String(html.text).length).toBeLessThanOrEqual(60);
      expect(html.artifact).toMatchObject({ mediaType: 'text/html; charset=utf-8' });
      expect(Buffer.from((html.artifact as { data: string }).data, 'base64').toString()).toContain(
        '<title>Tall</title>',
      );
      const desktop = await a.act({
        action: 'browserScreenshot',
        viewport: { width: 1024, height: 700 },
      });
      expect(png((desktop.artifact as { data: string }).data)).toMatchObject({
        width: 1024,
        height: 700,
      });
      await mobile.act({ action: 'browserClose' });
    }, 120_000);

    it('reports an interrupted submit as uncertain instead of failed or done', async () => {
      await a.act({ action: 'browserNavigate', url: `${origin}/hang-form` });
      const snapshot = await a.act({ action: 'browserSnapshot' });
      const result = await a.act({
        action: 'browserClick',
        ref: find(snapshot, 'Enviar').ref,
        timeoutMs: 2000,
      });
      expect(result).toMatchObject({ uncertain: true });
      expect(result.pendingRequests).toBeGreaterThanOrEqual(1);
    }, 60_000);

    it('ends access of an existing session when the bot is removed from the project', async () => {
      await saveProject('shop', ['bot-b']);
      const revoked = await a.act({ action: 'browserNavigate', url: `${origin}/whoami` });
      expect(revoked.error?.code).toBe('access_revoked');
      expect((await a.act({ action: 'browserSnapshot' })).error).toMatchObject({
        code: 'session_closed',
        state: 'revoked',
      });
      await saveProject('shop', ['bot-a', 'bot-b']);
      a = await open(botA, 'run-a');
    }, 60_000);

    it("reaches only the session project's READY preview through Traefik and binds results to it", async () => {
      await f.configure();
      await f.client.command({
        action: 'saveSettings',
        definition: { port: await freePort() },
        revision: 0,
      });
      const environment = (await f.client.state()).environments.find((item) => item.id === 'node')!;
      await f.client.command({
        action: 'saveEnvironment',
        definition: {
          ...environment,
          services: [
            {
              id: 'web',
              builder: 'image',
              image: 'node:22-alpine',
              command: `node -e "require('node:http').createServer((q,s)=>{s.setHeader('content-type','text/html');s.end('<title>Preview</title><p>preview-ok</p>')}).listen(3000,'0.0.0.0')"`,
              expose: true,
            },
          ] as Environment['services'],
        },
        revision: environment.revision,
      });
      const project = (await f.client.state()).projects.find((item) => item.id === 'project')!;
      await f.client.command({
        action: 'saveProject',
        definition: { ...project, programming: { browser: { enabled: true } } },
        revision: project.revision,
      });
      await f.task();
      const preview = (await f.job({ action: 'startPreview', taskId: 'change' })).result as Preview;
      expect(preview.state).toBe('ready');
      const url = preview.urls[0]!.url;
      const coder = await call(f.coder, {
        action: 'browserSession',
        projectId: 'project',
        kind: 'test',
        runId: 'run-p',
      });
      const act = (command: Record<string, unknown>) =>
        call(f.coder, { ...command, sessionId: coder.sessionId, runId: 'run-p' });
      const reached = await act({ action: 'browserNavigate', url });
      expect(reached, JSON.stringify(reached)).toMatchObject({
        status: 200,
        title: 'Preview',
        preview: {
          previewId: preview.id,
          taskId: 'change',
          environmentId: 'node',
          serviceId: 'web',
        },
        decisions: [expect.objectContaining({ rule: 'preview', allowed: true })],
      });
      expect((reached.preview as { previewCreatedAt: string }).previewCreatedAt).toBe(
        preview.createdAt,
      );
      const other = await a.act({ action: 'browserNavigate', url });
      expect(other.error?.code).toBe('navigation_denied');
      await f.job({ action: 'stopPreview', previewId: preview.id });
      expect((await act({ action: 'browserNavigate', url })).error?.code).toBe('navigation_denied');
      await act({ action: 'browserClose' });
    }, 400_000);

    it('fails sessions explicitly and cleans up when the browser container crashes, then recovers', async () => {
      const extra = await open(botB, 'run-crash');
      await runCommand('docker', ['kill', `${f.namespace}-browser`]);
      const status = await eventually(
        () => call(f.client, { action: 'browserStatus' }),
        (value) => value.state === 'failed',
        30_000,
      );
      expect(status.lastError).toMatchObject({ reason: 'browser_crashed' });
      const sessions = status.sessions as { sessionId: string; state: string; code?: string }[];
      for (const id of [a.sessionId, extra.sessionId])
        expect(sessions.find((item) => item.sessionId === id)).toMatchObject({
          state: 'failed',
          code: 'browser_crashed',
        });
      expect((await a.act({ action: 'browserSnapshot' })).error?.code).toBe('session_failed');
      await eventually(
        async () =>
          (
            await runCommand('docker', ['ps', '-aq', '--filter', `name=^${f.namespace}-browser`])
          ).stdout.trim(),
        (ids) => ids === '',
        30_000,
      );
      a = await open(botA, 'run-a');
      expect((await a.act({ action: 'browserNavigate', url: `${origin}/whoami` })).status).toBe(
        200,
      );
    }, 180_000);

    it('removes orphan browser containers and fails their sessions when the runner restarts', async () => {
      await f.stop('SIGKILL');
      expect(
        (
          await runCommand('docker', ['ps', '-q', '--filter', `name=^${f.namespace}-browser$`])
        ).stdout.trim(),
      ).not.toBe('');
      await f.start();
      expect(
        (
          await runCommand('docker', [
            'ps',
            '-aq',
            '--filter',
            `label=io.oinko.owner=${f.namespace}`,
            '--filter',
            'label=io.oinko.role=browser',
          ])
        ).stdout.trim(),
      ).toBe('');
      expect(
        (
          await runCommand('docker', [
            'network',
            'ls',
            '-q',
            '--filter',
            `name=^${f.namespace}-browser`,
          ])
        ).stdout.trim(),
      ).toBe('');
      const status = await call(f.client, { action: 'browserStatus' });
      expect(status.state).toBe('stopped');
      expect(
        (status.sessions as { sessionId: string; state: string; code?: string }[]).find(
          (s) => s.sessionId === a.sessionId,
        ),
      ).toMatchObject({
        state: 'failed',
        code: 'runner_restarted',
      });
      expect(
        (await a.act({ action: 'browserNavigate', url: `${origin}/whoami` })).error?.code,
      ).toBe('session_failed');
    }, 180_000);

    it('expires idle sessions and stops the browser container after the idle period', async () => {
      // A graceful stop removes the containers synchronously; restart with short timers.
      await f.stop();
      await f.start({ OINKO_BROWSER_IDLE_MS: '1500', OINKO_BROWSER_SESSION_IDLE_MS: '2000' });
      const idle = await open(botA, 'run-idle');
      expect((await call(f.client, { action: 'browserStatus' })).state).toBe('running');
      const expired = await eventually(
        () => call(botA, { action: 'browserStatus', sessionId: idle.sessionId }),
        (value) => (value.sessions as { state: string }[])[0]?.state === 'expired',
        20_000,
      );
      expect((expired.sessions as { reason?: string }[])[0]?.reason).toBe('idle_timeout');
      await eventually(
        async () =>
          (
            await runCommand('docker', ['ps', '-aq', '--filter', `name=^${f.namespace}-browser`])
          ).stdout.trim() + String((await call(f.client, { action: 'browserStatus' })).state),
        (value) => value === 'stopped',
        20_000,
      );
      expect((await idle.act({ action: 'browserSnapshot' })).error).toMatchObject({
        code: 'session_closed',
        state: 'expired',
      });
      // A graceful runner stop with a live session leaves no container behind.
      await open(botA, 'run-shutdown');
      await f.stop();
      expect(
        (
          await runCommand('docker', ['ps', '-aq', '--filter', `name=^${f.namespace}-browser`])
        ).stdout.trim(),
      ).toBe('');
      await f.start();
    }, 120_000);
  },
);
