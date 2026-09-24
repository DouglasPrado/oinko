import { z } from 'zod';

/**
 * Browser commands handled by the runner's browser extension (M05).
 * `browserStatus` reports availability; the full contract lives in
 * `src/browser/`.
 */
export const BROWSER_COMMANDS = [z.object({ action: z.literal('browserStatus') })] as const;
