import { createHiggsfieldIntegration } from '@oinko/mcp-higgsfield';
import { CREDENTIAL_PATH } from './higgsfield-auth.js';
import { config } from './config.js';
const integration = createHiggsfieldIntegration({ credentialPath: CREDENTIAL_PATH, url: config.higgsfield.url, timeoutMs: config.higgsfield.timeoutMs });
export const uploadImage = integration.uploadImage;
export const closeHiggsfieldMedia = integration.close;
