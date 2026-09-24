import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EnvironmentSchema, type Preview } from '../src/contracts/index.js';
import { runCommand } from '../src/runtime/command.js';
import { probeRoute } from '../src/routing/probe.js';
import { RuntimeFixture, freePort } from './helpers/runtime.js';

describe.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'untrusted recipes and operational failures through the runner',
  () => {
    let f: RuntimeFixture;
    beforeAll(async () => {
      f = new RuntimeFixture();
      await f.start();
      await f.configure();
      await f.task();
    }, 90_000);
    afterAll(async () => {
      await f.cleanup();
    }, 60_000);

    const forbidden = [
      ['privileged', '    privileged: true'],
      ['host network', '    network_mode: host'],
      ['host process namespace', '    pid: host'],
      ['host IPC', '    ipc: host'],
      ['host devices', '    devices: [/dev/mem:/dev/mem]'],
      ['capabilities', '    cap_add: [SYS_ADMIN]'],
      ['Docker socket', '    volumes: [/var/run/docker.sock:/var/run/docker.sock]'],
      ['absolute host mount', '    volumes: [/Users:/host]'],
      ['parent mount', '    volumes: [../:/host]'],
      ['symlink mount', '    volumes: [./escape:/host]'],
      ['external volume', '    volumes: [outside:/data]\nvolumes:\n  outside:\n    external: true'],
      [
        'volume driver',
        '    volumes: [outside:/data]\nvolumes:\n  outside:\n    driver_opts: { device: /, o: bind, type: none }',
      ],
      ['external network', '    networks: [outside]\nnetworks:\n  outside:\n    external: true'],
      ['include', 'include: [other.yaml]'],
      ['extends', '    extends: { file: other.yaml, service: web }'],
      ['host env file', '    env_file: /etc/passwd'],
      ['implicit host variable', '    environment: [HOME]'],
      ['unselected secret', '    environment: { TOKEN: "${PRIVATE}" }'],
      ['build context escape', '    build: { context: ../ }'],
      ['Dockerfile escape', '    build: { context: ., dockerfile: ../../Dockerfile }'],
      ['unreviewed build SSH', '    build: { context: ., ssh: [default] }'],
    ];
    it.each(forbidden)(
      'refuses Compose %s before creating application containers',
      async (_name, patch) => {
        await f.shell('ln -sfn /tmp escape');
        await f.write('compose.yaml', `services:\n  web:\n    image: node:22-alpine\n${patch}\n`);
        const env = (await f.client.state()).environments[0]!;
        await f.client.command({
          action: 'saveEnvironment',
          definition: {
            ...env,
            compose: { repositoryId: 'app', path: 'compose.yaml' },
            services: [],
          },
          secrets: { PRIVATE: 'not-selected-private-value' },
          revision: env.revision,
        });
        const result = await f.job({ action: 'startPreview', taskId: 'change' }, 'failed');
        expect(result.error).toBeTruthy();
        const state = await f.client.state();
        expect(state.previews[0]).toMatchObject({ state: 'failed', urls: [] });
        expect(JSON.stringify(state)).not.toContain('not-selected-private-value');
        expect(
          (
            await runCommand('docker', ['ps', '-aq', '--filter', `name=^${f.namespace}-p-`])
          ).stdout.trim(),
        ).toBe('');
      },
      30_000,
    );

    it.each([
      ['no services', {}],
      [
        'missing repository',
        { services: [{ id: 'web', repositoryId: 'missing', builder: 'dockerfile' }] },
      ],
      [
        'missing Dockerfile',
        {
          services: [
            { id: 'web', repositoryId: 'app', builder: 'dockerfile', dockerfile: 'missing' },
          ],
        },
      ],
      [
        'missing context',
        {
          services: [{ id: 'web', repositoryId: 'app', builder: 'dockerfile', context: 'missing' }],
        },
      ],
      ['missing secret', { services: [{ id: 'web', secrets: ['MISSING'] }] }],
      ['missing Compose file', { compose: { repositoryId: 'app', path: 'missing.yaml' } }],
      [
        'missing build target',
        {
          services: [
            { id: 'web', repositoryId: 'app', builder: 'dockerfile', buildTarget: 'missing' },
          ],
        },
      ],
      [
        'build command failure',
        {
          services: [
            { id: 'web', repositoryId: 'app', builder: 'dockerfile', buildTarget: 'unused' },
          ],
        },
      ],
      ['missing image', { services: [{ id: 'web', image: 'node:oinko-nonexistent-test-tag' }] }],
    ])(
      'persists %s as a failed job and preview with readable logs',
      async (_name, patch) => {
        const env = (await f.client.state()).environments[0]!;
        await f.client.command({
          action: 'saveEnvironment',
          definition: EnvironmentSchema.parse({ id: env.id, name: env.name, ...patch }),
          revision: env.revision,
        });
        const failed = await f.job({ action: 'startPreview', taskId: 'change' }, 'failed');
        expect(failed.finishedAt).toBeTruthy();
        const log = await f.client.command<{ text: string }>({
          action: 'jobLogs',
          jobId: failed.id,
        });
        expect(log.text).toContain(failed.error!);
        expect((await f.client.state()).previews[0]?.state).toBe('failed');
      },
      90_000,
    );

    it('fails an unhealthy Compose service and succeeds after editing the worktree recipe', async () => {
      await f.write(
        'compose.yaml',
        `services:
  web:
    image: node:22-alpine
    command: [sleep, infinity]
    healthcheck:
      test: [CMD, 'false']
      interval: 1s
      timeout: 1s
      retries: 1
`,
      );
      const env = (await f.client.state()).environments[0]!;
      await f.client.command({
        action: 'saveEnvironment',
        definition: {
          id: env.id,
          name: env.name,
          compose: { repositoryId: 'app', path: 'compose.yaml' },
        },
        revision: env.revision,
      });
      const failed = await f.job({ action: 'startPreview', taskId: 'change' }, 'failed');
      expect(failed.error).toMatch(/unhealthy/);
      await f.write(
        'compose.yaml',
        `services:\n  web:\n    image: node:22-alpine\n    command: [sleep, infinity]\n`,
      );
      await f.job({ action: 'startPreview', taskId: 'change' });
      expect((await f.client.state()).previews[0]).toMatchObject({ state: 'ready', urls: [] });
      await f.job({ action: 'stopPreview', previewId: 'change' });
    }, 90_000);

    it('imports a build target, env file, literal dollars, health dependency and internal volume without publishing repository ports', async () => {
      await f.write('app.env', 'FROM_FILE="file-value"\n');
      await f.write(
        'compose.yaml',
        `services:
  db:
    image: redis:8-alpine
    volumes: [data:/data]
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 1s
      timeout: 1s
      retries: 5
  web:
    build:
      context: .
      target: web
      args:
        PUBLIC_VALUE: \${PUBLIC_VALUE:-fallback}
    command: [sh, -c, 'echo $$TOKEN; echo $$FROM_FILE; node apps/web/server.cjs']
    env_file: app.env
    environment:
      TOKEN: \${TOKEN}
    depends_on:
      db: { condition: service_healthy }
    ports: ['65530:3000']
    labels: { traefik.enable: 'true' }
volumes:
  data: {}
`,
      );
      const port = await freePort();
      const state = await f.client.state();
      await f.client.command({
        action: 'saveSettings',
        definition: { port, bindAddress: '0.0.0.0' },
        revision: state.settings!.revision,
      });
      await f.client.command({
        action: 'saveEnvironment',
        definition: {
          id: 'node',
          name: 'Node',
          network: 'none',
          compose: { repositoryId: 'app', path: 'compose.yaml' },
          services: [
            {
              id: 'web',
              expose: true,
              secrets: ['TOKEN'],
              buildEnvironment: { PUBLIC_VALUE: 'compose-build' },
            },
          ],
        },
        secrets: { TOKEN: 'private-compose-token' },
        revision: state.environments[0]!.revision,
      });
      const ready = (await f.job({ action: 'startPreview', taskId: 'change' })).result as Preview;
      expect(ready.urls.map((url) => url.serviceId)).toEqual(['web']);
      expect((await probeRoute(port, new URL(ready.urls[0]!.url).hostname)).body).toBe(
        'original|compose-build',
      );
      const logs = await f.client.command<{ text: string }>({
        action: 'previewLogs',
        previewId: ready.id,
      });
      expect(logs.text).toContain('file-value');
      expect(logs.text).toContain('[redacted]');
      expect(logs.text).not.toContain('private-compose-token');
      for (const id of ['web', 'db']) {
        const [container] = JSON.parse(
          (await runCommand('docker', ['inspect', `${f.namespace}-p-change-${id}`])).stdout,
        );
        expect(Object.keys(container.HostConfig.PortBindings ?? {})).toEqual([]);
        expect(container.Config.Labels['traefik.enable']).toBeUndefined();
        expect(
          container.Mounts.some((m: { Source: string }) => m.Source.includes('docker.sock')),
        ).toBe(false);
      }
      const [network] = JSON.parse(
        (await runCommand('docker', ['network', 'inspect', `${f.namespace}-p-change_default`]))
          .stdout,
      );
      expect(network.Internal).toBe(true);
      const [proxy] = JSON.parse(
        (await runCommand('docker', ['inspect', `${f.namespace}-proxy`])).stdout,
      );
      expect(proxy.HostConfig.PortBindings['8080/tcp'][0]).toMatchObject({
        HostIp: '0.0.0.0',
        HostPort: String(port),
      });
      const stored = readFileSync(
        join(f.root, '.harness/runtime/previews/change/compose.json'),
        'utf8',
      );
      expect(stored).not.toContain('private-compose-token');
      await f.stop();
      await f.start();
      expect((await f.client.state()).previews[0]?.state).toBe('ready');
      await runCommand('docker', ['rm', '-f', `${f.namespace}-p-change-db`]);
      await f.stop();
      await f.start();
      expect((await f.client.state()).previews[0]?.state).toBe('failed');
      await f.job({ action: 'stopPreview', previewId: 'change' });
    }, 120_000);

    it('waits for actual HTTP health and records timeout instead of claiming a running container is ready', async () => {
      const state = await f.client.state();
      await f.client.command({
        action: 'saveEnvironment',
        definition: {
          id: 'node',
          name: 'Node',
          services: [
            {
              id: 'web',
              image: 'node:22-alpine',
              command: `node -e "require('http').createServer((req,res)=>{res.statusCode=503;res.end('unavailable')}).listen(3000,'0.0.0.0')"`,
              expose: true,
            },
          ],
        },
        revision: state.environments[0]!.revision,
      });
      const failed = await f.job({ action: 'startPreview', taskId: 'change' }, 'failed');
      expect(failed.error).toMatch(/não ficaram disponíveis/);
      expect((await f.client.state()).previews[0]).toMatchObject({ state: 'failed', urls: [] });
      await f.job({ action: 'stopPreview', previewId: 'change' });
    }, 150_000);
  },
);
