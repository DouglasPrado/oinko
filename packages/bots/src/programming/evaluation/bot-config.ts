import { ProgrammingPolicySchema, type BotConfigPort, type TelemetryJournal } from '@oinko/agent-runtime/programming';
import type { BotStore } from '../../store.js';
import { recordBotConfiguration } from '../audit.js';

/**
 * Candidate promotion and rollback write through the bot store with its
 * revision check, and the same validation as any other edit.
 */
export function botConfigPort(store: BotStore, journal?: TelemetryJournal): BotConfigPort {
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
      // Same configuration audit as any other edit, attributed to the evaluation flow.
      if (journal) recordBotConfiguration(journal, definition, store.runtime(botId).definition, 'evaluation', saved.revision);
      return { revision: saved.revision };
    },
  };
}
