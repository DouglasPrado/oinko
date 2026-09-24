import { ProgrammingPolicySchema, type BotConfigPort } from '@oinko/agent-runtime/programming';
import type { BotStore } from '../../store.js';

/**
 * Candidate promotion and rollback write through the bot store with its
 * revision check, and the same validation as any other edit.
 */
export function botConfigPort(store: BotStore): BotConfigPort {
  return {
    read(botId) {
      if (!store.has(botId)) return undefined;
      const { definition, revision } = store.runtime(botId);
      return {
        revision,
        programmingPolicy: definition.programmingPolicy ?? ProgrammingPolicySchema.parse({}),
        systemPrompt: definition.systemPrompt,
      };
    },
    write(botId, change, expectedRevision) {
      const { definition } = store.runtime(botId);
      const saved = store.save({ ...definition, programmingPolicy: change.programmingPolicy, systemPrompt: change.systemPrompt }, {}, expectedRevision);
      return { revision: saved.revision };
    },
  };
}
