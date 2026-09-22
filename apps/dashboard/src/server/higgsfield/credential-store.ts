import 'server-only';
import { resolve } from 'node:path';
import { env } from '@/config/env';
import {
  credentialStatus as status,
  storeCredential,
  type StoredCredential,
} from '@oinko/mcp-higgsfield';
export type { StoredCredential, CredentialStatus } from '@oinko/mcp-higgsfield';
export function credentialStatus() {
  return status(resolve(env.HIGGSFIELD_CREDENTIAL_PATH));
}
export async function saveCredential(credential: StoredCredential): Promise<void> {
  await storeCredential(resolve(env.HIGGSFIELD_CREDENTIAL_PATH), credential);
}
