/* eslint-disable @typescript-eslint/no-explicit-any -- sandbox replies are untyped JSON by design */
import { join } from 'node:path';
import type { Project } from '@oinko/workspaces';
import type { RunnerContext } from '../runtime/extensions.js';
import { workspaceOps, type OpsDeps } from '../workspace/ops.js';
import { PUBLICATION_ERROR_CODES, PublicationError, type PublicationErrorCode } from './errors.js';
import type { GitEndpoint } from './git.js';

type SandboxDeps = OpsDeps & { workspaceOps: typeof workspaceOps };

/**
 * Steps that run *inside* the project sandbox, where the repository's own
 * configuration may do anything but no credential exists. Serialized with
 * `toString()` like `workspaceOps`, so it may only use `deps`.
 *
 * - `inspect`: branch, HEAD and current tree hash of the task worktree.
 * - `prepare`: refuses unless the worktree tree equals `expectedRevision`;
 *   creates the commit object for that exact tree with `commit-tree` (no
 *   hooks), deterministic for a given operation, and points a temporary ref
 *   at it for the host mirror to fetch. The task branch is not moved yet.
 * - `advance`: compare-and-swap of the task branch to the reviewed commit
 *   (`update-ref new old`), never a reset; refreshes only the index.
 */
function publicationSandboxOps(request: any, deps: SandboxDeps): any {
  const { fs, child } = deps;
  const root: string = fs.realpathSync(request.root ?? process.cwd());
  const fail = (code: string, message: string, details?: Record<string, unknown>) => {
    const error: any = new Error(message);
    error.opsCode = code;
    error.details = details;
    throw error;
  };
  const git = (args: string[], env: Record<string, string> = {}): string =>
    child
      .execFileSync(
        'git',
        [
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'core.fsmonitor=false',
          '-c',
          'gc.auto=0',
          '-c',
          'maintenance.auto=false',
          ...args,
        ],
        {
          cwd: root,
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
        },
      )
      .trim();
  const attempt = (args: string[]): string | undefined => {
    try {
      return git(args);
    } catch {
      return undefined;
    }
  };
  const branchRef = attempt(['symbolic-ref', '-q', 'HEAD']);
  const head = attempt(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  const expectBranch = () => {
    if (branchRef !== `refs/heads/${request.branch}`)
      fail('branch_mismatch', `A worktree não está no ramo da tarefa (${request.branch}).`, {
        currentBranch: branchRef ?? null,
      });
    if (!head) fail('unborn_branch', 'O ramo da tarefa ainda não tem commits.');
  };
  switch (request.op) {
    case 'inspect':
      return {
        branchRef: branchRef ?? null,
        headSha: head ?? null,
        revision: deps.workspaceOps({ op: 'treeHash', root }, deps).revision,
      };
    case 'prepare': {
      expectBranch();
      const revision: string = deps.workspaceOps({ op: 'treeHash', root }, deps).revision;
      if (revision !== request.expectedRevision)
        fail(
          'revision_changed',
          'A worktree mudou depois da revisão; revise novamente antes de publicar.',
          {
            currentRevision: revision,
          },
        );
      const tree = revision.slice('tree:'.length);
      let commit = head!;
      let created = false;
      if (git(['rev-parse', `${head}^{tree}`]) !== tree) {
        const date = `@${request.date} +0000`;
        commit = git(['commit-tree', tree, '-p', head!, '-m', request.message], {
          GIT_AUTHOR_NAME: request.identity.name,
          GIT_AUTHOR_EMAIL: request.identity.email,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_NAME: request.identity.name,
          GIT_COMMITTER_EMAIL: request.identity.email,
          GIT_COMMITTER_DATE: date,
        });
        created = true;
      }
      git(['update-ref', request.tempRef, commit]);
      return { headSha: head, commitSha: commit, created, revision };
    }
    case 'advance': {
      expectBranch();
      let indexRefreshed = true;
      if (head !== request.commitSha) {
        if (head !== request.expectedHead)
          fail('branch_moved', 'O ramo da tarefa recebeu outro commit durante a publicação.', {
            currentHead: head,
          });
        git([
          'update-ref',
          '-m',
          'oinko: publicação revisada',
          `refs/heads/${request.branch}`,
          request.commitSha,
          request.expectedHead,
        ]);
        // The index follows the new HEAD; working files are never touched.
        indexRefreshed =
          attempt(['read-tree', '-m', request.commitSha]) !== undefined ||
          attempt(['read-tree', request.commitSha]) !== undefined;
      }
      attempt(['update-ref', '-d', request.tempRef]);
      return { headSha: request.commitSha, advanced: head !== request.commitSha, indexRefreshed };
    }
    case 'cleanup':
      attempt(['update-ref', '-d', request.tempRef]);
      return { cleaned: true };
    default:
      return fail('unknown_op', `Operação desconhecida: ${String(request.op)}`);
  }
}

/** Script run by `node -e` in the sandbox: JSON request on stdin, JSON reply on stdout. */
const PUBLICATION_SANDBOX_SCRIPT = `
const deps = { fs: require('node:fs'), path: require('node:path'), crypto: require('node:crypto'), child: require('node:child_process') };
deps.workspaceOps = (${workspaceOps.toString()});
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const result = (${publicationSandboxOps.toString()})(JSON.parse(input), deps);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: { code: error.opsCode || 'sandbox_failed', message: String(error.message || error).slice(0, 2000), details: error.details } }));
  }
});
`;

const CODES: ReadonlySet<string> = new Set(PUBLICATION_ERROR_CODES);
function decode(reply: any): Record<string, any> {
  if (reply && typeof reply === 'object' && reply.error) {
    const code = CODES.has(reply.error.code)
      ? (reply.error.code as PublicationErrorCode)
      : 'sandbox_failed';
    throw new PublicationError(code, String(reply.error.message ?? 'Falha no sandbox.'), {
      ...(reply.error.details && { details: reply.error.details }),
      retryable: code === 'sandbox_failed',
    });
  }
  if (!reply || typeof reply !== 'object')
    throw new PublicationError('sandbox_failed', 'Resposta inválida do sandbox.', {
      retryable: true,
    });
  return reply;
}

/** In-sandbox steps and the Git source the host mirror fetches from. */
interface PublicationSandbox {
  run(request: Record<string, unknown>): Promise<Record<string, any>>;
  source(): Promise<GitEndpoint>;
}
export type SandboxFactory = (
  context: RunnerContext,
  project: Project,
  taskId: string,
  repositoryId: string,
) => PublicationSandbox;

/**
 * Production: steps run in the project container, and the host mirror
 * fetches through `ext::docker exec … git upload-pack`, so `upload-pack` reads
 * the (writable) clone configuration inside the container, never on the host.
 */
export const dockerPublicationSandbox: SandboxFactory = (
  context,
  project,
  taskId,
  repositoryId,
) => ({
  async run(request) {
    const result = await context.sandbox.exec(
      project,
      ['node', '-e', PUBLICATION_SANDBOX_SCRIPT],
      `/workspace/tasks/${taskId}/${repositoryId}`,
      { input: JSON.stringify(request), timeoutMs: 180_000, allowFailure: true },
    );
    try {
      return decode(JSON.parse(result.stdout));
    } catch (error) {
      if (error instanceof PublicationError) throw error;
      throw new PublicationError(
        'sandbox_failed',
        `O sandbox não respondeu à publicação: ${result.stderr.slice(-500)}`,
        {
          retryable: true,
        },
      );
    }
  },
  async source() {
    const name = await context.sandbox.ensure(project);
    return {
      url: `ext::docker exec -i ${name} git %s /workspace/repositories/${repositoryId}`,
      protocol: 'ext',
    };
  },
});

/**
 * Tests and development without Docker only: runs the same steps in this
 * process on the host layout `.harness/workspaces/<project>` and fetches the
 * clone over `file://`. Production always uses `dockerPublicationSandbox`.
 */
export const localPublicationSandbox: SandboxFactory = (context, project, taskId, repositoryId) => {
  const base = context.sandbox.path(project.id);
  return {
    async run(request) {
      const deps: SandboxDeps = {
        fs: await import('node:fs'),
        path: await import('node:path'),
        crypto: await import('node:crypto'),
        child: await import('node:child_process'),
        workspaceOps,
      };
      let reply: any;
      try {
        reply = publicationSandboxOps(
          { ...request, root: join(base, 'tasks', taskId, repositoryId) },
          deps,
        );
      } catch (error) {
        const value = error as Error & { opsCode?: string; details?: Record<string, unknown> };
        reply = {
          error: {
            code: value.opsCode ?? 'sandbox_failed',
            message: value.message,
            details: value.details,
          },
        };
      }
      return decode(reply);
    },
    async source() {
      return { url: `file://${join(base, 'repositories', repositoryId)}`, protocol: 'file' };
    },
  };
};
