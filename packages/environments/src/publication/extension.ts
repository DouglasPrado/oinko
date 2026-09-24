import type { RunnerCommandValue } from '../contracts/requests.js';
import type { RunnerContext, RunnerExtension } from '../runtime/extensions.js';

/** GitHub App and isolated draft-PR publication (M06). */
export class PublicationExtension implements RunnerExtension {
  readonly actions: ReadonlySet<string> = new Set(['publicationStatus']);
  async handle(command: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    void context;
    if (command.action === 'publicationStatus') return { configured: false };
    throw new Error(`Ação de publicação desconhecida: ${command.action}`);
  }
}
