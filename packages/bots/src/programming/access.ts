import { WorkspaceStore } from '@oinko/workspaces';
import {
  DEFAULT_PROGRAMMING_POLICY,
  type AccessPort,
  type BotAccessView,
  type ProjectAccessView,
} from '@oinko/agent-runtime/programming';
import { BotStore } from '../store.js';

/**
 * Current bot and project authorization, read from the shared stores on every
 * call. Nothing is cached: revoking a bot in the dashboard takes effect on the
 * next operation of any process.
 */
export class StoreAccess implements AccessPort {
  constructor(
    private readonly bots: BotStore,
    private readonly workspaces: WorkspaceStore,
  ) {}

  bot(botId: string): BotAccessView | undefined {
    if (!this.bots.has(botId)) return undefined;
    const profile = this.bots.get(botId);
    return {
      id: profile.id,
      model: profile.model,
      revision: profile.revision,
      telemetry: profile.telemetry,
      programming: profile.programmingPolicy ?? DEFAULT_PROGRAMMING_POLICY,
    };
  }

  project(projectId: string): ProjectAccessView | undefined {
    try {
      const project = this.workspaces.project(projectId);
      return {
        id: project.id,
        revision: project.revision,
        allowedBotIds: project.allowedBotIds,
        repositories: project.repositories,
        ...(project.programming && { programming: project.programming }),
      };
    } catch {
      return undefined;
    }
  }

  projectIdsFor(botId: string): string[] {
    return this.workspaces
      .projects()
      .filter((project) => project.allowedBotIds.includes(botId))
      .map((project) => project.id);
  }
}
