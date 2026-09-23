import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { Id, WorkspaceError } from '@oinko/workspaces';
import { ImageName } from '../contracts/index.js';

export function safePath(root: string, path: string): string {
  const base = realpathSync(root);
  const requested = resolve(base, path);
  const resolved = realpathSync(requested);
  const rel = relative(base, resolved);
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel))
    throw new WorkspaceError('Caminho fora do workspace autorizado.');
  return resolved;
}
const ObjectValue = z.record(z.string(), z.unknown());
export interface ComposeDocument {
  services: Record<string, Record<string, unknown>>;
  volumes: Record<string, unknown>;
}
const allowedServiceKeys = new Set([
  'image',
  'build',
  'command',
  'entrypoint',
  'working_dir',
  'environment',
  'env_file',
  'volumes',
  'depends_on',
  'ports',
  'expose',
  'healthcheck',
  'restart',
  'user',
  'init',
  'labels',
  'networks',
  'stop_grace_period',
  'read_only',
  'tmpfs',
]);

/** Parse a repository recipe into data only; host capabilities never come from that recipe. */
export function validateCompose(input: unknown, root: string): ComposeDocument {
  const value = ObjectValue.parse(input);
  for (const key of Object.keys(value))
    if (
      !['name', 'version', 'services', 'volumes', 'networks'].includes(key) &&
      !key.startsWith('x-')
    )
      throw new WorkspaceError(`Compose: campo não permitido: ${key}.`);
  const rawServices = ObjectValue.parse(value.services);
  if (!Object.keys(rawServices).length || Object.keys(rawServices).length > 30)
    throw new WorkspaceError('Compose precisa de 1 a 30 serviços.');
  const volumes = ObjectValue.parse(value.volumes ?? {});
  for (const [name, config] of Object.entries(volumes)) {
    Id.parse(name);
    if (config !== null && Object.keys(ObjectValue.parse(config)).length)
      throw new WorkspaceError('Use volumes locais gerenciados, sem driver ou nome externo.');
  }
  for (const config of Object.values(ObjectValue.parse(value.networks ?? {}))) {
    if (config !== null && Object.keys(ObjectValue.parse(config)).length)
      throw new WorkspaceError('Redes Compose são gerenciadas pelo Oinko. Remova opções externas.');
  }
  const services: ComposeDocument['services'] = {};
  for (const [id, raw] of Object.entries(rawServices)) {
    Id.parse(id);
    const service = ObjectValue.parse(raw);
    for (const key of Object.keys(service))
      if (!allowedServiceKeys.has(key))
        throw new WorkspaceError(`Compose: ${id}.${key} não permitido.`);
    if (service.image && !z.string().parse(service.image).includes('$'))
      ImageName.parse(service.image);
    if (service.build) {
      const build =
        typeof service.build === 'string'
          ? { context: service.build }
          : ObjectValue.parse(service.build);
      for (const key of Object.keys(build))
        if (!['context', 'dockerfile', 'args', 'target'].includes(key))
          throw new WorkspaceError(`Compose: build.${key} não permitido.`);
      const context = safePath(root, z.string().parse(build.context ?? '.'));
      safePath(context, z.string().parse(build.dockerfile ?? 'Dockerfile'));
    }
    if (service.env_file) {
      const files = Array.isArray(service.env_file) ? service.env_file : [service.env_file];
      files.forEach((file) => safePath(root, z.string().parse(file)));
    }
    for (const mount of z.array(z.unknown()).parse(service.volumes ?? [])) {
      if (typeof mount !== 'string')
        throw new WorkspaceError('Use volumes Compose na forma origem:destino[:ro].');
      const [source, target, mode, extra] = mount.split(':');
      if (!source || !target?.startsWith('/') || extra || (mode && !['ro', 'rw'].includes(mode)))
        throw new WorkspaceError('Volume Compose inválido.');
      if (source.startsWith('.')) safePath(root, source);
      else if (!Object.hasOwn(volumes, source))
        throw new WorkspaceError(
          'Monte somente pastas relativas do projeto ou volumes declarados.',
        );
    }
    services[id] = service;
  }
  return { services, volumes };
}
