import { PUBLICATION_COMMANDS } from '../contracts/publication-requests.js';
import type { RunnerCommandValue } from '../contracts/requests.js';
import type { RunnerContext, RunnerExtension } from '../runtime/extensions.js';
import { PublicationService, type PublicationOptions } from './service.js';
import { PublicationStore } from './store.js';

export type { PublicationOptions } from './service.js';

/**
 * GitHub App and isolated draft-PR publication (M06). The runner constructs it
 * with production defaults (Docker sandbox, real GitHub); tests inject a local
 * sandbox seam, short timeouts and fault hooks through `options`.
 */
export class PublicationExtension implements RunnerExtension {
  readonly actions: ReadonlySet<string> = new Set(
    PUBLICATION_COMMANDS.map((schema) => schema.shape.action.value as string),
  );
  private service?: PublicationService;
  constructor(private readonly options: PublicationOptions = {}) {}
  private open(root: string) {
    if (!this.service || this.service.store.root !== root)
      this.service = new PublicationService(new PublicationStore(root), this.options);
    return this.service;
  }
  handle(command: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    return this.open(context.root).handle(command, context);
  }
  async recover(context: Omit<RunnerContext, 'botId' | 'correlation'>) {
    this.open(context.root).recover();
  }
  async close() {
    this.service?.store.close();
    this.service = undefined;
  }
}
