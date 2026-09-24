import { expect, it } from 'vitest';
import { LLMClient } from '../../../src/llm/llm-client.js';
import type { TelemetryLLMCall } from '../../../src/contracts/entities/telemetry.js';
import { createContextSummaryWriter } from '../../../src/core/context-summary-writer.js';
import { buildContext } from '../../../src/core/context-builder.js';
import { createSSEResponse, textResponseFrames } from '../../e2e/helpers.js';

it('counts and records summary usage even when the model returns an empty summary', async () => {
  const records: TelemetryLLMCall[] = [];
  const client = new LLMClient({
    apiKey: 'test',
    model: 'test',
    fetch: () =>
      Promise.resolve(
        createSSEResponse(
          textResponseFrames({
            content: '',
            usage: { prompt_tokens: 23, completion_tokens: 7, total_tokens: 30 },
          }),
        ),
      ),
  });
  const summarize = createContextSummaryWriter({
    client,
    model: 'test',
    maxTokens: 300,
    traceId: 'summary',
    records,
  });
  await expect(summarize('prior messages', 'valid previous summary')).rejects.toThrow('Empty');
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    usage: { inputTokens: 23, outputTokens: 7, totalTokens: 30 },
    costStatus: 'unavailable',
    error: { message: expect.stringContaining('Empty') },
  });
});

it('does not report preserved pinned messages as dropped when the context target is exceeded', () => {
  const result = buildContext({
    history: [{ role: 'user', content: 'constraint '.repeat(300), pinned: true, createdAt: 0 }],
    injections: [],
    maxTokens: 10,
    reserveTokens: 0,
    maxPinnedMessages: 1,
    preserveHistory: true,
  });
  expect(result.messages).toHaveLength(1);
  expect(result.droppedPinnedCount).toBe(0);
});
