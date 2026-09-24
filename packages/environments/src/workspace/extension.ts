import type { RunnerCommandValue } from '../contracts/requests.js';
import type { RunnerContext, RunnerExtension } from '../runtime/extensions.js';

/** Search, ranged reads, precise edits, diffs and checks inside the sandbox (M02). */
export class WorkspaceExtension implements RunnerExtension {
  readonly actions: ReadonlySet<string> = new Set<string>();
  async handle(command: RunnerCommandValue, context: RunnerContext): Promise<unknown> {
    void context;
    throw new Error(`Ação de workspace desconhecida: ${command.action}`);
  }
}
