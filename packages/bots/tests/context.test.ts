import { expect, it } from 'vitest';
import { BotDefinitionSchema } from '../src/schema.js';

const bot = { id: 'dev', name: 'Dev', model: 'test', systemPrompt: 'Programar.' };
it('preserves optional context policy, applies shared defaults and rejects invalid budgets', () => {
  expect(BotDefinitionSchema.parse(bot).context).toBeUndefined();
  expect(BotDefinitionSchema.parse({ ...bot, context: { enabled: true } }).context).toMatchObject({
    enabled: true,
    maxInputTokens: 20000,
    fastInputTokens: 8000,
    selectTools: true,
  });
  expect(
    BotDefinitionSchema.safeParse({ ...bot, context: { enabled: true, maxInputTokens: 0 } })
      .success,
  ).toBe(false);
});
