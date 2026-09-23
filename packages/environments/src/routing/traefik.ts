import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { WorkspaceError } from '@oinko/workspaces';
import type { CommandRunner, Settings } from '../contracts/index.js';
import type { PreparedCompose } from '../runtime/compose.js';
import { probeRoute } from './probe.js';

function hostname(name: string, service: string, domain: string) {
  return `${service.slice(0, 24)}-${createHash('sha256').update(`${name}/${service}`).digest('hex').slice(0, 12)}.${domain}`;
}

export class TraefikRouter {
  readonly name: string;
  readonly directory: string;
  constructor(
    root: string,
    namespace: string,
    private readonly run: CommandRunner,
  ) {
    this.name = `${namespace}-proxy`;
    this.directory = join(root, '.harness/runtime/traefik');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }
  async ensure(settings: Settings) {
    const running = await this.run(
      'docker',
      ['inspect', '--format', '{{.State.Running}}', this.name],
      { allowFailure: true },
    );
    if (running.stdout.trim() === 'true') return;
    if (running.exitCode === 0) {
      await this.run('docker', ['start', this.name]);
      return;
    }
    await this.run('docker', [
      'run',
      '-d',
      '--name',
      this.name,
      '--label',
      'io.oinko.role=proxy',
      '--restart',
      'unless-stopped',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--read-only',
      '--publish',
      `${settings.bindAddress}:${settings.port}:8080`,
      '--mount',
      `type=bind,source=${this.directory},target=/etc/oinko,readonly`,
      'traefik:v3.6',
      '--entrypoints.web.address=:8080',
      '--providers.file.directory=/etc/oinko',
      '--providers.file.watch=true',
      '--api=false',
      '--log.level=WARN',
    ]);
  }
  async publish(prepared: PreparedCompose, settings: Settings) {
    if (!prepared.routes.length) return [];
    await this.ensure(settings);
    const connected = await this.run(
      'docker',
      ['network', 'connect', prepared.edgeNetwork, this.name],
      { allowFailure: true },
    );
    if (connected.exitCode && !connected.stderr.includes('already exists'))
      throw new WorkspaceError(connected.stderr);
    const routers: Record<string, unknown> = {};
    const services: Record<string, unknown> = {};
    const urls = prepared.routes.map((route) => {
      const key = `${prepared.name}-${route.serviceId}`;
      const host = hostname(prepared.routeGroup ?? prepared.name, route.serviceId, settings.domain);
      routers[key] = { rule: `Host(\`${host}\`)`, service: key, entryPoints: ['web'] };
      services[key] = {
        loadBalancer: { servers: [{ url: `http://${route.container}:${route.port}` }] },
      };
      return { serviceId: route.serviceId, url: `http://${host}:${settings.port}` };
    });
    // JSON is valid YAML; Traefik's file provider watches .yaml/.yml/.toml extensions.
    const file = join(this.directory, `${prepared.name}.yaml`);
    writeFileSync(`${file}.tmp`, JSON.stringify({ http: { routers, services } }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return urls;
  }
  async ready(prepared: PreparedCompose, settings: Settings, timeoutMs = 90_000) {
    const deadline = Date.now() + timeoutMs;
    let waiting = prepared.routes;
    while (waiting.length && Date.now() < deadline) {
      const next: typeof waiting = [];
      for (const route of waiting) {
        try {
          const response = await probeRoute(
            settings.port,
            hostname(prepared.routeGroup ?? prepared.name, route.serviceId, settings.domain),
            route.healthPath,
          );
          if (response.status < 200 || response.status >= 400) next.push(route);
        } catch {
          next.push(route);
        }
      }
      waiting = next;
      if (waiting.length) await delay(750);
    }
    if (waiting.length)
      throw new WorkspaceError(
        `Serviços não ficaram disponíveis: ${waiting.map((route) => route.serviceId).join(', ')}. Consulte os logs e a porta configurada.`,
      );
  }
  async unpublish(name: string) {
    rmSync(join(this.directory, `${name}.yaml`), { force: true });
    await this.run('docker', ['network', 'disconnect', '-f', `${name}-edge`, this.name], {
      allowFailure: true,
    });
  }
}
