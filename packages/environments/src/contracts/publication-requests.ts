import { z } from 'zod';

/**
 * Publication commands handled by the runner's publication extension (M06).
 * `publicationStatus` reports configuration; the full contract lives in
 * `src/publication/`.
 */
export const PUBLICATION_COMMANDS = [z.object({ action: z.literal('publicationStatus') })] as const;
