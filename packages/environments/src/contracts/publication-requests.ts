import { z } from 'zod';
import { Id } from '@oinko/workspaces/contracts';

/**
 * Publication commands handled by the runner's publication extension (M06):
 * GitHub App configuration, isolated authenticated push, draft pull requests
 * and CI inspection. Behaviour, error codes and security decisions are
 * documented in `packages/environments/README.md` ("Publicação no GitHub").
 */

/** Tree hash produced by the workspace operations (`tree:<sha>`). */
const TreeRevision = z
  .string()
  .regex(/^tree:[0-9a-f]{40}(?:[0-9a-f]{24})?$/, 'Revisão inválida; use tree:<sha>.');
const CommitSha = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/, 'SHA de commit inválido.');
const OperationId = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => ![...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f),
    'Identificador de operação inválido.',
  );
const Location = { taskId: Id, repositoryId: Id };

function loopback(url: URL) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
}
/** HTTPS endpoint; plain HTTP only on loopback (fake servers in tests). */
const ApiUrl = z
  .string()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || (url.protocol === 'http:' && loopback(url))) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use uma URL HTTPS sem credenciais (HTTP apenas em loopback).')
  .transform((value) => value.replace(/\/+$/, ''));
/** Git remote base: HTTPS, or an absolute `file://` directory for local tests. */
const GitUrl = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.protocol === 'file:') return !url.host && url.pathname.startsWith('/');
      return (
        url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
      );
    } catch {
      return false;
    }
  }, 'Use uma URL HTTPS sem credenciais ou file:///caminho/absoluto.')
  .transform((value) => value.replace(/\/+$/, ''));

const CHECK_RESULTS = ['passed', 'failed', 'skipped', 'cancelled', 'timed_out'] as const;
const LocalCheck = z.object({
  kind: z.enum(['install', 'test', 'lint', 'build', 'typecheck', 'format', 'custom']),
  name: z.string().trim().min(1).max(100).optional(),
  result: z.enum(CHECK_RESULTS),
  /** Tree hash the check ran against; must equal the published revision. */
  revision: TreeRevision,
});
export type LocalCheckValue = z.infer<typeof LocalCheck>;

const Title = z.string().trim().min(1).max(256);
const Body = z.string().max(60_000);

export const PUBLICATION_COMMANDS = [
  /** Compatibility alias of `githubAppStatus`. */
  z.object({ action: z.literal('publicationStatus') }),
  /** Administrator only. Saving again rotates the private key. */
  z.object({
    action: z.literal('saveGithubApp'),
    appId: z.union([
      z.number().int().positive().transform(String),
      z.string().regex(/^(?:\d{1,12}|Iv[0-9A-Za-z._-]{4,60})$/, 'App ID ou Client ID inválido.'),
    ]),
    privateKeyPem: z.string().min(100).max(20_000),
    apiUrl: ApiUrl.default('https://api.github.com'),
    webUrl: ApiUrl.default('https://github.com'),
    gitUrl: GitUrl.default('https://github.com'),
  }),
  /** Non-secret metadata; `verify` asks GitHub whether the App JWT is accepted. */
  z.object({ action: z.literal('githubAppStatus'), verify: z.boolean().default(false) }),
  /** Installation state and effective access to each linked repository. */
  z.object({ action: z.literal('githubInstallation'), projectId: Id }),
  /** Read-only review of exactly what `publish` would push. */
  z.object({ action: z.literal('reviewPublication'), ...Location, expectedRevision: TreeRevision }),
  /** Commit the reviewed revision, push the task branch and ensure its draft PR. */
  z.object({
    action: z.literal('publish'),
    ...Location,
    operationId: OperationId,
    expectedRevision: TreeRevision,
    commitMessage: z
      .string()
      .trim()
      .min(1)
      .max(5_000)
      .refine((value) => !value.includes('\0'), 'Mensagem de commit inválida.'),
    title: Title,
    body: Body,
    checks: z.array(LocalCheck).max(50).default([]),
  }),
  /** Create or update the task's single draft PR; never duplicates, merges or approves. */
  z.object({
    action: z.literal('ensureDraftPullRequest'),
    ...Location,
    operationId: OperationId,
    title: Title,
    body: Body,
    /** Explicit decision: number of the closed/merged PR this new draft replaces. */
    replaceClosed: z.number().int().positive().optional(),
  }),
  /** Remote branch, PR and local receipts after a crash or lost response. */
  z.object({ action: z.literal('reconcilePublication'), ...Location }),
  /** Checks and commit statuses of exactly one commit. */
  z.object({ action: z.literal('inspectChecks'), ...Location, sha: CommitSha }),
  /** Persisted publication telemetry (identifiers only), in order. */
  z.object({
    action: z.literal('publicationEvents'),
    projectId: Id.optional(),
    after: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(500).default(100),
  }),
] as const;
