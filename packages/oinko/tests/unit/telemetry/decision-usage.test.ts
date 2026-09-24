import { expect, it } from 'vitest';
import { JevDecider } from '../../../src/decision/jev-decider.js';
import { RecordingDecider } from '../../../src/decision/recording-decider.js';
import { DECISION_USAGE } from '../../../src/contracts/entities/decider.js';

it('records provider-reported decision tokens without adding a fake question or assuming free cost', async () => {
  const records: unknown[] = [];
  const decider = new RecordingDecider(
    new JevDecider({
      apiKey: 'test',
      fetch: async () =>
        Response.json({
          answers: { tool0: { noul: 0.95 } },
          usage: { input_tokens: 3913, output_tokens: 588 },
        }),
    }),
    (record) => records.push(record),
  );
  const result = await decider.decide('current task', {
    tool0: { kind: 'bool', instructions: 'need this tool?' },
  });
  expect(Object.keys(result)).toEqual(['tool0']);
  expect(result[DECISION_USAGE]).toEqual({
    inputTokens: 3913,
    outputTokens: 588,
    totalTokens: 4501,
  });
  expect(records[0]).toMatchObject({
    point: 'tool_selection',
    usage: { inputTokens: 3913, outputTokens: 588, totalTokens: 4501 },
  });
});
