import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceError } from '@oinko/workspaces';
import type { CommandRunner, Service } from '../contracts/index.js';
import { safePath } from '../policies/index.js';
import { runCommand } from '../runtime/command.js';

const RAILPACK_VERSION = '0.39.0';
interface BuildInput {
  service: Service;
  source?: string;
  tag: string;
  directory: string;
  onOutput?: (text: string) => void;
}
export interface ImageBuilder {
  build(input: BuildInput): Promise<string>;
}

class ExistingImageBuilder implements ImageBuilder {
  constructor(private readonly run: CommandRunner) {}
  async build({ service, onOutput }: BuildInput) {
    const exists = await this.run('docker', ['image', 'inspect', service.image], {
      allowFailure: true,
    });
    if (exists.exitCode !== 0)
      await this.run('docker', ['pull', service.image], { timeoutMs: 600_000, onOutput });
    return service.image;
  }
}
class DockerfileBuilder implements ImageBuilder {
  constructor(private readonly run: CommandRunner) {}
  async build({ service, source, tag, onOutput }: BuildInput) {
    if (!source) throw new WorkspaceError('Selecione o repositório de build.');
    const context = safePath(source, service.context);
    const dockerfile = safePath(context, service.dockerfile);
    const args = ['build', '--tag', tag, '--file', dockerfile];
    if (service.buildTarget) args.push('--target', service.buildTarget);
    for (const [key, value] of Object.entries(service.buildEnvironment))
      args.push('--build-arg', `${key}=${value}`);
    args.push(context);
    await this.run('docker', args, { timeoutMs: 900_000, onOutput });
    return tag;
  }
}
class RailpackBuilder implements ImageBuilder {
  constructor(
    private readonly root: string,
    private readonly run: CommandRunner,
  ) {}
  async binary() {
    if (process.env.OINKO_RAILPACK_BIN) return process.env.OINKO_RAILPACK_BIN;
    const directory = join(this.root, '.harness/runtime/tools', `railpack-${RAILPACK_VERSION}`);
    const binary = join(directory, 'railpack');
    if (existsSync(binary)) return binary;
    const platform =
      process.platform === 'darwin'
        ? 'apple-darwin'
        : process.platform === 'linux'
          ? 'unknown-linux-musl'
          : '';
    const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : '';
    if (!platform || !arch)
      throw new WorkspaceError('Instale Railpack e configure OINKO_RAILPACK_BIN nesta plataforma.');
    const name = `railpack-v${RAILPACK_VERSION}-${arch}-${platform}.tar.gz`;
    const url = `https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}`;
    const checksumResponse = await fetch(`${url}/checksums.txt`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!checksumResponse.ok)
      throw new WorkspaceError('Não foi possível obter os checksums do Railpack.');
    const checksum = (await checksumResponse.text())
      .split('\n')
      .find((line) => line.endsWith(name))
      ?.split(/\s+/)[0];
    if (!checksum || !/^[a-f0-9]{64}$/.test(checksum))
      throw new WorkspaceError('Distribuição Railpack não encontrada.');
    const response = await fetch(`${url}/${name}`, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new WorkspaceError('Download do Railpack falhou.');
    const archive = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(archive).digest('hex') !== checksum)
      throw new WorkspaceError('Checksum Railpack divergente.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const archivePath = join(directory, 'download.tar.gz');
    writeFileSync(archivePath, archive, { mode: 0o600 });
    await this.run('tar', ['-xzf', archivePath, '-C', directory, 'railpack']);
    chmodSync(binary, 0o700);
    return binary;
  }
  async build({ service, source, tag, directory, onOutput }: BuildInput) {
    if (!source) throw new WorkspaceError('Selecione o repositório de build.');
    const context = safePath(source, service.context);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const plan = join(directory, `${service.id}-railpack-plan.json`);
    const args = ['prepare', context, '--plan-out', plan];
    if (service.buildCommand) args.push('--build-cmd', service.buildCommand);
    if (service.command) args.push('--start-cmd', service.command);
    for (const [key, value] of Object.entries(service.buildEnvironment))
      args.push('--env', `${key}=${value}`);
    await this.run(await this.binary(), args, { timeoutMs: 180_000, onOutput });
    // Validate output before handing it to Docker. The builder alone owns this path.
    JSON.parse(readFileSync(plan, 'utf8'));
    const publicValues = Object.entries(service.buildEnvironment).map(([key, value]) => {
      const path = join(directory, `${service.id}-build-${key}`);
      writeFileSync(path, value, { mode: 0o600 });
      return { key, path };
    });
    try {
      await this.run(
        'docker',
        [
          'buildx',
          'build',
          '--load',
          '--progress=plain',
          '--tag',
          tag,
          '--build-arg',
          `BUILDKIT_SYNTAX=ghcr.io/railwayapp/railpack-frontend:v${RAILPACK_VERSION}`,
          '--build-arg',
          `cache-key=${tag}`,
          '--build-arg',
          `secrets-hash=${createHash('sha256').update(JSON.stringify(service.buildEnvironment)).digest('hex')}`,
          ...publicValues.flatMap(({ key, path }) => ['--secret', `id=${key},src=${path}`]),
          '--file',
          plan,
          context,
        ],
        { timeoutMs: 900_000, onOutput },
      );
    } finally {
      for (const { path } of publicValues) rmSync(path, { force: true });
    }
    return tag;
  }
}

export function imageBuilders(
  root: string,
  run: CommandRunner = runCommand,
): Record<Service['builder'], ImageBuilder> {
  return {
    image: new ExistingImageBuilder(run),
    dockerfile: new DockerfileBuilder(run),
    railpack: new RailpackBuilder(root, run),
  };
}
