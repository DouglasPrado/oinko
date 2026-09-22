import { fileURLToPath } from 'node:url';
import { higgsfieldHeaders as headers, type HeadersOptions } from '@oinko/mcp-higgsfield';
export { readCredential } from '@oinko/mcp-higgsfield';
export const CREDENTIAL_PATH = process.env.HIGGSFIELD_CREDENTIAL_PATH ?? fileURLToPath(new URL('../../../.harness/credentials/higgsfield.json', import.meta.url));
export function higgsfieldHeaders(options: Partial<HeadersOptions> = {}) { return headers({ ...options, path: options.path ?? CREDENTIAL_PATH }); }
