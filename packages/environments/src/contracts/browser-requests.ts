import { z } from 'zod';
import { Id } from '@oinko/workspaces/contracts';

/**
 * Browser commands handled by the runner's browser extension (M05).
 *
 * Sessions belong to one bot + run + project and a kind: `docs` (public
 * documentation) or `test` (project previews, allowed origins and test
 * credentials). Every action names its session and is authorized again.
 * `runId` may come from the request correlation instead of the command.
 * Results are plain JSON; failures are returned as `{ error: { code, ... } }`
 * (see `src/browser/errors.ts` for the codes).
 */
const SessionId = z.string().regex(/^bs-[a-f0-9]{24}$/);
const RunId = z.string().min(1).max(100);
const Timeout = z.number().int().min(100).max(60_000).optional();
const Ref = z.string().regex(/^e[1-9][0-9]{0,3}$/);
const SnapshotId = z.string().regex(/^s[1-9][0-9]{0,6}$/);
const CredentialName = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const Viewport = z.object({
  width: z.number().int().min(240).max(3840),
  height: z.number().int().min(240).max(4320),
});
const Session = { sessionId: SessionId, runId: RunId.optional() };

export const BROWSER_COMMANDS = [
  z.object({ action: z.literal('browserStatus'), sessionId: SessionId.optional() }),
  z.object({
    action: z.literal('browserSession'),
    projectId: Id,
    kind: z.enum(['docs', 'test']),
    runId: RunId.optional(),
    viewport: Viewport.optional(),
    /** Touch, mobile meta viewport and 390x844 unless a viewport is given. */
    mobile: z.boolean().default(false),
  }),
  z.object({
    action: z.literal('browserNavigate'),
    ...Session,
    url: z.string().min(1).max(2000),
    waitUntil: z.enum(['commit', 'domcontentloaded', 'load', 'networkidle']).default('load'),
    timeoutMs: Timeout,
  }),
  z.object({
    action: z.literal('browserSnapshot'),
    ...Session,
    maxText: z.number().int().min(0).max(20_000).default(3000),
    maxElements: z.number().int().min(0).max(300).default(100),
    /** Full redacted page content as an artifact instead of the context. */
    full: z.enum(['none', 'text', 'html']).default('none'),
  }),
  z.object({
    action: z.literal('browserClick'),
    ...Session,
    ref: Ref,
    snapshotId: SnapshotId.optional(),
    timeoutMs: Timeout,
  }),
  z
    .object({
      action: z.literal('browserFill'),
      ...Session,
      ref: Ref,
      snapshotId: SnapshotId.optional(),
      value: z.string().max(10_000).optional(),
      credential: z
        .object({ name: CredentialName, field: z.enum(['username', 'password']) })
        .optional(),
      /** Press Enter after filling (submits most forms). */
      submit: z.boolean().default(false),
      timeoutMs: Timeout,
    })
    .refine(
      (command) => (command.value === undefined) !== (command.credential === undefined),
      'Informe value ou credential, não ambos.',
    ),
  z
    .object({
      action: z.literal('browserWait'),
      ...Session,
      text: z.string().min(1).max(500).optional(),
      selector: z.string().min(1).max(500).optional(),
      ms: z.number().int().min(0).max(30_000).optional(),
      timeoutMs: Timeout,
    })
    .refine(
      (command) =>
        [command.text, command.selector, command.ms].filter((value) => value !== undefined)
          .length === 1,
      'Informe exatamente um de text, selector ou ms.',
    ),
  z.object({
    action: z.literal('browserScreenshot'),
    ...Session,
    fullPage: z.boolean().default(false),
    viewport: Viewport.optional(),
  }),
  z.object({
    action: z.literal('browserDiagnostics'),
    ...Session,
    limit: z.number().int().min(1).max(200).default(50),
  }),
  z.object({ action: z.literal('browserClose'), ...Session }),
  z.object({
    action: z.literal('browserSaveCredential'),
    projectId: Id,
    name: CredentialName,
    username: z.string().min(4).max(500),
    password: z.string().min(4).max(500),
  }),
  z.object({ action: z.literal('browserDeleteCredential'), projectId: Id, name: CredentialName }),
  z.object({ action: z.literal('browserCredentials'), projectId: Id }),
] as const;
