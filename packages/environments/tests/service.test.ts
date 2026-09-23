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
