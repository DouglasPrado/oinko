import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Id,
  RepositorySchema,
  WorkspaceError,
  type Project,
  type WorkspaceExecutor,
} from '@oinko/workspaces';
import { type CommandOptions, type CommandRunner, type Environment } from '../contracts/index.js';
import { runCommand } from '../runtime/command.js';

export class DockerSandbox implements WorkspaceExecutor {
  readonly namespace: string;
  constructor(
    readonly root: string,
    private readonly environment: (id: string) => Environment,
    readonly run: CommandRunner = runCommand,
    private readonly output?: (text: string) => void,
  ) {
    this.namespace = `oinko-${createHash('sha256').update(root).digest('hex').slice(0, 10)}`;
  }
  path(projectId: string) {
    return join(this.root, '.harness/workspaces', Id.parse(projectId));
  }
  name(projectId: string) {
    return `${this.namespace}-work-${Id.parse(projectId)}`;
  }
  async ensure(project: Project) {
    if (!project.environmentId)
      throw new WorkspaceError(
        'Configure o primeiro ambiente do projeto antes de preparar o sandbox.',
      );
    const config = this.environment(project.environmentId);
    const name = this.name(project.id);
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([2, config.workspaceImage, config.cpus, config.memoryMb, config.network]),
      )
      .digest('hex');
    const inspect = await this.run(
      'docker',
      [
        'inspect',
        '--format',
        '{{.State.Running}}|{{index .Config.Labels "io.oinko.config"}}',
        name,
      ],
      { allowFailure: true },
    );
    const [running, applied] = inspect.stdout.trim().split('|');
    if (inspect.exitCode === 0 && applied === fingerprint) {
      if (running !== 'true') await this.run('docker', ['start', name]);
      return name;
    }
    if (inspect.exitCode === 0) await this.run('docker', ['rm', '-f', name]);
    if (config.workspaceImage === 'oinko-workspace:1') {
      const available = await this.run('docker', ['image', 'inspect', config.workspaceImage], {
        allowFailure: true,
      });
      if (available.exitCode !== 0) {
        const context = join(this.root, '.harness/runtime/workspace-image');
        mkdirSync(context, { recursive: true, mode: 0o700 });
        writeFileSync(
          join(context, 'Dockerfile'),
          'FROM node:22-alpine\nRUN apk add --no-cache git bash coreutils openssh-client python3 curl && corepack enable\nENV HOME=/workspace/home\nWORKDIR /workspace\nCMD ["sleep", "infinity"]\n',
        );
        await this.run('docker', ['build', '--tag', config.workspaceImage, context], {
          timeoutMs: 600_000,
          onOutput: this.output,
        });
      }
    }
    const path = this.path(project.id);
    for (const part of ['repositories', 'tasks', 'home'])
      mkdirSync(join(path, part), { recursive: true, mode: 0o700 });
    await this.run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        name,
        '--label',
        `io.oinko.owner=${this.namespace}`,
        '--label',
        `io.oinko.project=${project.id}`,
        '--label',
        `io.oinko.config=${fingerprint}`,
        '--init',
        '--user',
        `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--read-only',
        '--pids-limit',
        '256',
        '--cpus',
        String(config.cpus),
        '--memory',
        `${config.memoryMb}m`,
        '--network',
        config.network === 'none' ? 'none' : 'bridge',
        '--tmpfs',
        '/tmp:rw,size=268435456',
        '--mount',
        `type=bind,source=${path},target=/workspace`,
        '--env',
        'HOME=/workspace/home',
        '--env',
        'GIT_AUTHOR_NAME=Oinko',
        '--env',
        'GIT_AUTHOR_EMAIL=oinko@localhost',
        '--env',
        'GIT_COMMITTER_NAME=Oinko',
        '--env',
        'GIT_COMMITTER_EMAIL=oinko@localhost',
        '--env',
        'GIT_CONFIG_COUNT=1',
        '--env',
        'GIT_CONFIG_KEY_0=safe.directory',
        '--env',
        'GIT_CONFIG_VALUE_0=*',
        '--workdir',
        '/workspace',
        config.workspaceImage,
        'sleep',
        'infinity',
      ],
      { onOutput: this.output },
    );
    return name;
  }
  async stop(projectId: string) {
    const result = await this.run('docker', ['rm', '-f', this.name(projectId)], {
      allowFailure: true,
    });
    if (result.exitCode !== 0 && !/No such (container|object)/i.test(result.stderr))
      throw new WorkspaceError(`Docker não conseguiu parar o sandbox: ${result.stderr}`);
  }
  async exec(project: Project, args: string[], cwd = '/workspace', options: CommandOptions = {}) {
    const name = await this.ensure(project);
    if (cwd !== '/workspace' && !cwd.startsWith('/workspace/'))
      throw new WorkspaceError('Diretório fora do sandbox.');
    return this.run('docker', ['exec', '-i', '--workdir', cwd, name, ...args], {
      ...options,
      onOutput: options.onOutput ?? this.output,
    });
  }
  async git(project: Project, args: string[], cwd: string) {
    const result = await this.exec(
      project,
      [
        'git',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.name=Oinko',
        '-c',
        'user.email=oinko@localhost',
        '-c',
        'safe.directory=*',
        ...args,
      ],
      cwd,
    );
    return result.stdout;
  }
  async importLocal(project: Project, repositoryId: string, source: string) {
    const destination = join(this.path(project.id), 'repositories', Id.parse(repositoryId));
    // A fresh clone copies no repository config/hooks and does not execute checkout filters.
    await this.run(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        'clone',
        '--no-checkout',
        '--no-local',
        '--no-hardlinks',
        '--',
        source,
        destination,
      ],
      { onOutput: this.output },
    );
    // Local origins would point outside the container. Preserve the real remote when present.
    const remote = await this.run('git', ['-C', source, 'config', '--get', 'remote.origin.url'], {
      allowFailure: true,
    });
    if (
      /^https:\/\//.test(remote.stdout.trim()) &&
      RepositorySchema.safeParse({ id: repositoryId, source: remote.stdout.trim() }).success
    )
      await this.git(
        project,
        ['remote', 'set-url', 'origin', remote.stdout.trim()],
        `/workspace/repositories/${repositoryId}`,
      );
  }
  async shell(
    project: Project,
    taskId: string,
    repositoryId: string,
    command: string,
    timeoutSeconds = 120,
  ) {
    Id.parse(taskId);
    Id.parse(repositoryId);
    const seconds = Math.max(1, Math.min(600, timeoutSeconds));
    return this.exec(
      project,
      ['timeout', '--signal=TERM', '--kill-after=5', String(seconds), 'bash', '-lc', command],
      `/workspace/tasks/${taskId}/${repositoryId}`,
      { timeoutMs: (seconds + 10) * 1000, allowFailure: true },
    );
  }
  async status(projectId: string) {
    const result = await this.run(
      'docker',
      ['inspect', '--format', '{{.State.Status}}', this.name(projectId)],
      { allowFailure: true },
    );
    if (result.exitCode === 0) return result.stdout.trim();
    if (/No such (container|object)/i.test(result.stderr)) return 'absent';
    throw new WorkspaceError(`Docker indisponível: ${result.stderr}`);
  }
}
