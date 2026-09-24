import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { startEnvironmentService } from '../src/runtime/service.js';
import { EnvironmentClient, environmentRequest, environmentSocket } from '../src/client/index.js';
import { RUNNER_ACTIONS } from '../src/contracts/requests.js';

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'oinko-runner-version-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** A runner process started from an older build, still listening on the socket. */
async function olderRunner(root: string, health: Record<string, unknown>) {
  const received: string[] = [];
  const server: Server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      return response.end(JSON.stringify(health));
    }
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      received.push((JSON.parse(body) as { command: { action: string } }).command.action);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(environmentSocket(root), resolve));
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return received;
}

it.each([
  ['answers health without listing its commands', { ready: true, pid: 4242 }],
  ['lists only the commands of its build', { ready: true, pid: 4242, actions: ['state', 'shell', 'readFile', 'writeFile'] }],
])('refuses a command an older runner does not know when it %s, and says how to fix it', async (_case, health) => {
  const root = tempRoot();
  const received = await olderRunner(root, health);
  const client = new EnvironmentClient(root, 'dev');
  expect(await client.command({ action: 'state' })).toEqual({ ok: true });
  await expect(
    client.command({ action: 'readRange', taskId: 'task', repositoryId: 'app', path: 'src/a.ts' }),
  ).rejects.toMatchObject({
    code: 'runner_outdated',
    message: expect.stringMatching(/versão anterior[\s\S]*readRange[\s\S]*Reinicie/),
    details: { action: 'readRange', pid: 4242 },
  });
  // The unknown command never reached the old process.
  expect(received).toEqual(['state']);
});

it('a current runner lists every command it handles, and the client lets them through', async () => {
  const root = tempRoot();
  const service = await startEnvironmentService(root);
  cleanup.push(() => service.close());
  const health = await environmentRequest<{ ready: boolean; actions: string[] }>(root, '/health');
  expect(health.ready).toBe(true);
  expect([...health.actions].sort()).toEqual([...RUNNER_ACTIONS].sort());
  expect(health.actions).toEqual(expect.arrayContaining(['shell', 'readRange', 'applyPatch', 'gitSnapshot', 'startCheck', 'browserSession', 'publish']));
  // An extension command fails for its own reason (unknown task), never as an outdated runner.
  const error: unknown = await new EnvironmentClient(root, 'dev')
    .command({ action: 'readRange', taskId: 'missing', repositoryId: 'app', path: 'a.ts' })
    .catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  expect((error as { code?: string }).code).not.toBe('runner_outdated');
});
