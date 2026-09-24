import type { RunnerCommandValue } from '../contracts/requests.js';
import type { RunnerContext, RunnerExtension } from '../runtime/extensions.js';

/** Isolated browser sessions for previews and public docs (M05). */
export class BrowserExtension implements RunnerExtension {
  readonly actions: ReadonlySet<string> = new Set(['browserStatus']);
  async handle(command: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    void context;
    if (command.action === 'browserStatus') return { available: false, reason: 'not_configured' };
    throw new Error(`Ação de browser desconhecida: ${command.action}`);
  }
}
