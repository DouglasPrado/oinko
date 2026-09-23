import { expect, it } from 'vitest';
import { EnvironmentSchema } from '../src/contracts/index.js';
import { DockerSandbox } from '../src/sandbox/docker.js';

it('distinguishes an absent container from an unavailable Docker daemon and does not claim a failed stop succeeded', async () => {
  let stderr = 'Error: No such object: sandbox';
  const sandbox = new DockerSandbox(
    '/tmp/oinko-status-fixture',
    () => EnvironmentSchema.parse({ id: 'node', name: 'Node' }),
    async () => ({ stdout: '', stderr, exitCode: 1 }),
  );
  expect(await sandbox.status('project')).toBe('absent');
  stderr = 'Cannot connect to the Docker daemon';
  await expect(sandbox.status('project')).rejects.toThrow(/Docker/);
  await expect(sandbox.stop('project')).rejects.toThrow(/Docker/);
});
