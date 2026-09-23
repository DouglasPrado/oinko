import { spawn } from 'node:child_process';
import { WorkspaceError } from '@oinko/workspaces';
import type { CommandRunner } from '../contracts/index.js';

/** No shell on the host; only explicit arguments and an allowlist of host variables. */
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const key of [
      'PATH',
      'HOME',
      'TMPDIR',
      'LANG',
      'DOCKER_HOST',
      'DOCKER_CONTEXT',
      'DOCKER_CONFIG',
      'DOCKER_CERT_PATH',
      'DOCKER_TLS_VERIFY',
    ])
      if (process.env[key]) env[key] = process.env[key];
    Object.assign(
      env,
      { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
      options.env,
    );
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs ?? 120_000),
      ...(options.signal ? [options.signal] : []),
    ]);
    if (signal.aborted) {
      reject(new WorkspaceError('Operação cancelada.'));
      return;
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    let stopped = false;
    let force: NodeJS.Timeout | undefined;
    const kill = (kind: NodeJS.Signals) => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch {
        /* process already exited */
      }
    };
    const abort = () => {
      stopped = true;
      kill('SIGTERM');
      force = setTimeout(() => kill('SIGKILL'), 2000);
      force.unref();
    };
    signal.addEventListener('abort', abort, { once: true });
    const clean = () => {
      signal.removeEventListener('abort', abort);
      if (force) clearTimeout(force);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text: string) => {
      stdout = (stdout + text).slice(-1_000_000);
      options.onOutput?.(text);
    });
    child.stderr.on('data', (text: string) => {
      stderr = (stderr + text).slice(-1_000_000);
      options.onOutput?.(text);
    });
    child.once('error', (error) => {
      clean();
      reject(new WorkspaceError(`Não foi possível executar ${command}: ${error.message}`));
    });
    child.once('close', (code) => {
      clean();
      if (stopped) reject(new WorkspaceError('Operação cancelada ou tempo limite excedido.'));
      else if (code !== 0 && !options.allowFailure)
        reject(
          new WorkspaceError(`${command} falhou (${code}): ${(stderr || stdout).slice(-4000)}`),
        );
      else resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    child.stdin.on('error', () => {
      /* command may exit before consuming stdin */
    });
    child.stdin.end(options.input);
  });
