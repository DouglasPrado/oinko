import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse } from 'yaml';
import { WorkspaceError, type Task } from '@oinko/workspaces';
import { ServiceSchema, type Environment, type CommandRunner } from '../contracts/index.js';
import { safePath, validateCompose } from '../policies/index.js';
import { imageBuilders } from '../builders/index.js';

export interface PreparedCompose {
  name: string;
  path: string;
  edgeNetwork: string;
  runtimeEnv: Record<string, string>;
  routeGroup?: string;
  redactions?: string[];
  expectedServices?: { id: string; completionAllowed: boolean }[];
  routes: { serviceId: string; container: string; port: number; healthPath: string }[];
}
const literal = (value: string) => value.replaceAll('$', () => '$$');
function containerLiteral(value: unknown): unknown {
  if (typeof value === 'string') return literal(value.replaceAll('$$', '$'));
  if (Array.isArray(value)) return value.map(containerLiteral);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, containerLiteral(item)]),
    );
  return value;
}
function environmentMap(raw: unknown): Record<string, string> {
  if (!raw) return {};
  if (Array.isArray(raw))
    return Object.fromEntries(
      raw.map((item) => {
        if (typeof item !== 'string' || !item.includes('='))
          throw new WorkspaceError('Defina valores explícitos nas variáveis Compose.');
        const at = item.indexOf('=');
        return [item.slice(0, at), item.slice(at + 1)];
      }),
    );
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
      if (value === null || value === undefined)
        throw new WorkspaceError(`Defina o valor de ${key}; variáveis do host não são herdadas.`);
      return [key, String(value)];
    }),
  );
}
function expand(value: string, variables: Record<string, string>) {
  return value.replace(
    /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, name, operator, fallback, short) => {
      if (_match === '$$') return '$';
      const key = name ?? short;
      if (variables[key] !== undefined && (variables[key] !== '' || !operator?.startsWith(':')))
        return variables[key];
      if (operator === ':-' || operator === '-') return fallback;
      throw new WorkspaceError(`Configure a variável ${key} do Compose no ambiente.`);
    },
  );
}

export async function prepareCompose(options: {
  root: string;
  workspace: string;
  environment: Environment;
  task: Task;
  name: string;
  directory: string;
  secrets: Record<string, string>;
  run: CommandRunner;
  onOutput?: (text: string) => void;
}): Promise<PreparedCompose> {
  const { root, workspace, environment, task, name, directory, secrets, run, onOutput } = options;
  const builders = imageBuilders(root, run);
  const edgeNetwork = `${name}-edge`;
  const services: Record<string, Record<string, unknown>> = {};
  const volumes: Record<string, Record<string, unknown>> = {};
  const routes: PreparedCompose['routes'] = [];
  const runtimeEnv: Record<string, string> = {};
  const redactions = new Set<string>();
  let definitions = environment.services;
  let imported: Record<string, Record<string, unknown>> = {};
  let composeRoot = '';
  if (environment.compose) {
    const repository = safePath(workspace, `tasks/${task.id}/${environment.compose.repositoryId}`);
    const path = safePath(repository, environment.compose.path);
    composeRoot = dirname(path);
    const source = readFileSync(path, 'utf8');
    if (source.length > 200_000) throw new WorkspaceError('Compose muito grande.');
    const document = validateCompose(parse(source, { maxAliasCount: 50 }), composeRoot);
    imported = document.services;
    for (const id of Object.keys(document.volumes)) volumes[id] = {};
    definitions = Object.entries(imported).map(([id, service]) => {
      const configured = environment.services.find((item) => item.id === id);
      const build =
        typeof service.build === 'string'
          ? { context: service.build }
          : (service.build as Record<string, unknown> | undefined);
      const publicValues = { ...configured?.environment, ...configured?.buildEnvironment };
      return ServiceSchema.parse({
        id,
        repositoryId: environment.compose!.repositoryId,
        builder: build ? 'dockerfile' : 'image',
        image: expand(String(service.image ?? 'node:22-alpine'), publicValues),
        context: build?.context ?? '.',
        dockerfile: build?.dockerfile ?? 'Dockerfile',
        buildTarget: build?.target ?? '',
        buildEnvironment: Object.fromEntries(
          Object.entries(environmentMap(build?.args)).map(([key, value]) => [
            key,
            expand(value, publicValues),
          ]),
        ),
        expose: configured?.expose ?? false,
        port: configured?.port ?? 3000,
        healthPath: configured?.healthPath ?? '/',
        mode: configured?.mode ?? 'image',
        workdir: configured?.workdir ?? '.',
        environment: configured?.environment ?? {},
        secrets: configured?.secrets ?? [],
      });
    });
  }
  if (!definitions.length)
    throw new WorkspaceError('Configure serviços ou um arquivo Compose para testar.');
  for (const service of definitions) {
    const selectedSecrets = Object.fromEntries(
      service.secrets.map((key) => {
        if (!Object.hasOwn(secrets, key)) throw new WorkspaceError(`Configure o segredo ${key}.`);
        redactions.add(secrets[key]!);
        return [key, secrets[key]!];
      }),
    );
    const original = imported[service.id];
    const repository = service.repositoryId
      ? safePath(workspace, `tasks/${task.id}/${service.repositoryId}`)
      : undefined;
    const source = original ? composeRoot : repository;
    const image = await builders[service.builder].build({
      service,
      source,
      tag: `${name}-${service.id}:preview`,
      directory,
      onOutput,
    });
    const variables: Record<string, string> = {};
    if (original?.env_file) {
      const paths = Array.isArray(original.env_file) ? original.env_file : [original.env_file];
      for (const file of paths) {
        const content = readFileSync(safePath(composeRoot, String(file)), 'utf8');
        if (content.length > 100_000)
          throw new WorkspaceError('Arquivo de variáveis muito grande.');
        for (const line of content.split('\n')) {
          if (!line.trim() || line.trim().startsWith('#')) continue;
          const at = line.indexOf('=');
          if (at < 1) throw new WorkspaceError('Use KEY=VALUE no arquivo de variáveis.');
          variables[line.slice(0, at).trim()] = line
            .slice(at + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, '$2');
        }
      }
    }
    Object.assign(variables, environmentMap(original?.environment), service.environment);
    const env: Record<string, string> = {};
    for (const [key, raw] of Object.entries(variables)) {
      const value = original ? expand(raw, { ...variables, ...selectedSecrets }) : raw;
      const token = `OINKO_VALUE_${service.id.replaceAll('-', '_')}_${key}`;
      runtimeEnv[token] = value;
      env[key] = '${' + token + ':?Variável do gerenciador ausente}';
    }
    for (const key of service.secrets) {
      if (!Object.hasOwn(secrets, key)) throw new WorkspaceError(`Configure o segredo ${key}.`);
      const token = `OINKO_SECRET_${service.id.replaceAll('-', '_')}_${key}`;
      runtimeEnv[token] = secrets[key]!;
      env[key] = '${' + token + ':?Segredo do gerenciador ausente}';
    }
    const mounts: unknown[] = [];
    if (original?.volumes)
      for (const mount of original.volumes as string[]) {
        const [from, target, mode] = mount.split(':');
        mounts.push(
          from!.startsWith('.')
            ? {
                type: 'bind',
                source: literal(safePath(composeRoot, from!)),
                target,
                read_only: mode === 'ro',
              }
            : { type: 'volume', source: from, target, read_only: mode === 'ro' },
        );
      }
    for (const volume of service.volumes) {
      volumes[volume.name] = {};
      mounts.push({ type: 'volume', source: volume.name, target: volume.target });
    }
    let command: unknown = containerLiteral(original?.command);
    if (service.command && service.builder !== 'railpack')
      command = ['/bin/sh', '-lc', literal(service.command)];
    let workingDir = original?.working_dir;
    if (service.mode === 'development') {
      if (!source) throw new WorkspaceError('Selecione o repositório para desenvolvimento.');
      mounts.push({ type: 'bind', source: literal(source), target: '/app' });
      safePath(source, service.workdir);
      workingDir = `/app/${service.workdir}`;
    }
    const fullName = `${name}-${service.id}`;
    // Docker accepts longer names, but each DNS label is limited to 63 bytes.
    const container =
      fullName.length <= 63
        ? fullName
        : `${fullName.slice(0, 50)}-${createHash('sha256').update(fullName).digest('hex').slice(0, 12)}`;
    services[service.id] = {
      image,
      container_name: container,
      init: true,
      labels: { 'io.oinko.preview': name, 'io.oinko.project': task.projectId },
      security_opt: ['no-new-privileges:true'],
      cap_drop: ['NET_RAW'],
      pids_limit: 256,
      cpus: environment.cpus,
      mem_limit: `${environment.memoryMb}m`,
      logging: { driver: 'json-file', options: { 'max-size': '5m', 'max-file': '2' } },
      ...(command ? { command } : {}),
      ...(workingDir ? { working_dir: workingDir } : {}),
      ...(original?.entrypoint ? { entrypoint: containerLiteral(original.entrypoint) } : {}),
      ...(original?.user ? { user: original.user } : {}),
      ...(original?.healthcheck ? { healthcheck: containerLiteral(original.healthcheck) } : {}),
      ...(original?.restart ? { restart: original.restart } : {}),
      ...(original?.stop_grace_period ? { stop_grace_period: original.stop_grace_period } : {}),
      ...(original?.read_only ? { read_only: true } : {}),
      ...(original?.tmpfs ? { tmpfs: original.tmpfs } : {}),
      environment: env,
      volumes: mounts,
      networks: service.expose ? ['default', 'edge'] : ['default'],
      ...(original?.depends_on
        ? { depends_on: original.depends_on }
        : service.dependsOn.length
          ? { depends_on: service.dependsOn }
          : {}),
    };
    if (service.expose)
      routes.push({
        serviceId: service.id,
        container,
        port: service.port,
        healthPath: service.healthPath,
      });
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'compose.json');
  writeFileSync(
    path,
    JSON.stringify(
      {
        name,
        services,
        volumes,
        networks: {
          default: { internal: environment.network === 'none' },
          edge: { name: edgeNetwork, internal: environment.network === 'none' },
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  const expectedServices = definitions.map(({ id }) => ({
    id,
    completionAllowed: Object.values(imported).some((service) => {
      const dependencies = service.depends_on;
      if (!dependencies || Array.isArray(dependencies) || typeof dependencies !== 'object')
        return false;
      const dependency = (dependencies as Record<string, unknown>)[id];
      return (
        !!dependency &&
        typeof dependency === 'object' &&
        'condition' in dependency &&
        dependency.condition === 'service_completed_successfully'
      );
    }),
  }));
  return {
    name,
    path,
    edgeNetwork,
    runtimeEnv,
    routes,
    expectedServices,
    redactions: [...redactions],
  };
}
