import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startEnvironmentService } from '../src/runtime/service.js';
import { environmentRequest, environmentSocket } from '../src/client/index.js';

it('serves persisted configuration through a private local socket and enforces bot access at the service', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-runner-'));
  let service = await startEnvironmentService(root);
  const call = (command: unknown, botId?: string) =>
    environmentRequest<Record<string, unknown>>(root, '/command', { command, botId });
  try {
    expect(statSync(environmentSocket(root)).mode & 0o777).toBe(0o600);
    await call({
      action: 'saveEnvironment',
      definition: { id: 'node', name: 'Node' },
      secrets: { TOKEN: 'secret-in-registry' },
      revision: 0,
    });
    await call({
      action: 'saveProject',
      definition: {
        id: 'app',
        name: 'App',
        environmentId: 'node',
        repositories: [{ id: 'repo', source: 'https://example.com/app.git' }],
        allowedBotIds: ['coder'],
      },
      revision: 0,
    });
    expect(JSON.stringify(await call({ action: 'state' }))).not.toContain('secret-in-registry');
    expect((await call({ action: 'state' }, 'intruder')).projects).toEqual([]);
    await expect(call({ action: 'startSandbox', projectId: 'app' }, 'intruder')).rejects.toThrow(
      /autorizado/,
    );
    await expect(
      call(
        { action: 'saveEnvironment', definition: { id: 'evil', name: 'Evil' }, revision: 0 },
        'coder',
      ),
    ).rejects.toThrow(/administrador/);
    service.controller.environments.saveJob({
      id: 'interrupted',
      type: 'createTask',
      projectId: 'app',
      state: 'running',
      createdAt: new Date().toISOString(),
    });
    service.controller.workspaces.saveTask(
      { id: 'partial', projectId: 'app', name: 'Partial', branch: 'task/partial' },
      0,
    );
    await service.close();
    service = await startEnvironmentService(root);
    expect((await call({ action: 'state' }, 'coder')).projects).toHaveLength(1);
    expect(service.controller.environments.job('interrupted').state).toBe('failed');
    expect(service.controller.workspaces.task('partial').state).toBe('failed');
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('answers a malformed command as invalid_request naming the field, so callers know nothing ran', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-runner-'));
  const service = await startEnvironmentService(root);
  try {
    const error = await environmentRequest(root, '/command', {
      command: { action: 'applyPatch', taskId: 'task', repositoryId: 'app', operationId: 'op-1', edits: [{ action: 'replace', path: 'a.ts', expectedHash: 'e38bf38f29bca5d4', oldText: 'a', newText: 'b' }] },
    }).catch((reason: unknown) => reason as { code?: string; message: string });
    expect(error).toMatchObject({ code: 'invalid_request', message: expect.stringContaining('command.edits.0.expectedHash') });
    expect((error as { message: string }).message).not.toContain('"code"');
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it('lets only the administrator delete a preview: it removes data a bot cannot bring back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-runner-'));
  const service = await startEnvironmentService(root);
  const call = (command: unknown, botId?: string) => environmentRequest(root, '/command', { command, botId });
  try {
    await expect(call({ action: 'deletePreview', previewId: 'shop-preview' }, 'coder')).rejects.toThrow(/administrador/);
    await expect(call({ action: 'deletePreview', previewId: 'shop-preview' })).rejects.toThrow(/Prévia não encontrada/);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
