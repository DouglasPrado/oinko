import { describe, it, expect } from 'vitest';
import {
  isReasoningModel,
  buildReasoningArgs,
  requiresNoSystemRole,
  rejectsToolsOnChatCompletions,
} from '../../../src/llm/reasoning.js';
import { LLMClient } from '../../../src/llm/llm-client.js';

describe('isReasoningModel', () => {
  it('recognises the o-series', () => {
    expect(isReasoningModel('o1')).toBe(true);
    expect(isReasoningModel('o3-mini')).toBe(true);
    expect(isReasoningModel('openai/o4-mini')).toBe(true);
  });

  it('recognises the gpt-5 and gpt-6 lines', () => {
    expect(isReasoningModel('gpt-5')).toBe(true);
    expect(isReasoningModel('gpt-5.4')).toBe(true);
    expect(isReasoningModel('openai/gpt-5.6-luna')).toBe(true);
    expect(isReasoningModel('gpt-6-astra')).toBe(true);
    expect(isReasoningModel('openai/gpt-6-astra-pro')).toBe(true);
  });

  it('does not treat older chat models as reasoning models', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('gpt-4-turbo')).toBe(false);
    expect(isReasoningModel('anthropic/claude-sonnet-5')).toBe(false);
  });
});

describe('buildReasoningArgs', () => {
  it('drops temperature for reasoning models', () => {
    expect(buildReasoningArgs('gpt-6-astra')).toHaveProperty('temperature', undefined);
  });

  it('leaves non-reasoning models untouched', () => {
    expect(buildReasoningArgs('gpt-4o')).toEqual({});
  });

  /**
   * Probing the live API: the gpt-5 line takes tools with no effort field, and
   * the gpt-6 line refuses tools whatever the value. So the client never sets
   * this on its own — only the caller does.
   */
  it('never sets a reasoning effort on its own', () => {
    expect(buildReasoningArgs('gpt-6-astra')).not.toHaveProperty('reasoningEffort');
    expect(buildReasoningArgs('gpt-5.4')).not.toHaveProperty('reasoningEffort');
    expect(buildReasoningArgs('gpt-4o')).not.toHaveProperty('reasoningEffort');
  });
});

describe('requiresNoSystemRole', () => {
  it('applies only to the original o1 family', () => {
    expect(requiresNoSystemRole('o1')).toBe(true);
    expect(requiresNoSystemRole('o1-preview')).toBe(true);
    expect(requiresNoSystemRole('o3')).toBe(false);
    expect(requiresNoSystemRole('gpt-6-astra')).toBe(false);
  });
});

describe('rejectsToolsOnChatCompletions', () => {
  it('flags the lines that only take tools via /v1/responses', () => {
    expect(rejectsToolsOnChatCompletions('gpt-6-astra')).toBe(true);
    expect(rejectsToolsOnChatCompletions('openai/gpt-6-astra-pro')).toBe(true);
    expect(rejectsToolsOnChatCompletions('gpt-5.6-luna')).toBe(true);
    expect(rejectsToolsOnChatCompletions('gpt-5.6-sol')).toBe(true);
    expect(rejectsToolsOnChatCompletions('gpt-5.6-terra')).toBe(true);
  });

  it('leaves models that do accept tools alone', () => {
    expect(rejectsToolsOnChatCompletions('gpt-5.5')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.4')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.4-mini')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-4o')).toBe(false);
    expect(rejectsToolsOnChatCompletions('anthropic/claude-sonnet-5')).toBe(false);
  });
});

describe('LLMClient request body for reasoning models', () => {
  async function captureBody(
    model: string,
    tools?: {
      type: 'function';
      function: { name: string; description: string; parameters: object };
    }[],
  ): Promise<Record<string, unknown>> {
    let captured: Record<string, unknown> = {};

    const client = new LLMClient({
      apiKey: 'k',
      model,
      baseUrl: 'https://example.test/v1',
      fetch: async (request: Request) => {
        captured = JSON.parse(await request.text()) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 },
        );
      },
    });

    await client.chat({
      messages: [{ role: 'user', content: 'hi' }],
      maxTokens: 100,
      ...(tools !== undefined && { tools }),
    });

    return captured;
  }

  const TOOL = [
    {
      type: 'function' as const,
      function: { name: 't', description: 'd', parameters: { type: 'object' } },
    },
  ];

  it('refuses tools for a model that cannot take them on this endpoint', async () => {
    await expect(captureBody('gpt-6-astra', TOOL)).rejects.toThrow(
      /does not accept function tools on \/chat\/completions/,
    );
  });

  it('sends no reasoning_effort for a model that accepts tools', async () => {
    const body = await captureBody('gpt-5.4', TOOL);
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.tools).toBeDefined();
  });

  /**
   * The internal name is camelCase; the wire name is snake_case. Spreading the
   * internal object into the body once leaked `reasoningEffort` alongside the
   * correct key, and the provider rejected the whole request with
   * "Unknown parameter". Asserting presence was not enough — absence matters.
   */
  it('never leaks the internal camelCase name onto the wire', async () => {
    const withTools = await captureBody('gpt-5.4', TOOL);
    const withoutTools = await captureBody('gpt-6-astra');
    const chatModel = await captureBody('gpt-4o', TOOL);

    for (const body of [withTools, withoutTools, chatModel]) {
      expect(body).not.toHaveProperty('reasoningEffort');
    }
  });

  it('sends no unknown parameters for a reasoning model with tools', async () => {
    const body = await captureBody('gpt-5.4', TOOL);
    const allowed = new Set([
      'model',
      'messages',
      'stream',
      'temperature',
      'tools',
      'reasoning_effort',
      'max_completion_tokens',
      'max_tokens',
      'response_format',
      'seed',
      'stream_options',
    ]);

    expect(Object.keys(body).filter((k) => !allowed.has(k))).toEqual([]);
  });

  it('omits the field when the model has no tools', async () => {
    const body = await captureBody('gpt-6-astra');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('omits the field for non-reasoning models', async () => {
    const body = await captureBody('gpt-4o', TOOL);
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('uses max_completion_tokens for the gpt-6 line', async () => {
    const body = await captureBody('gpt-6-astra');
    expect(body.max_completion_tokens).toBe(100);
    expect(body).not.toHaveProperty('max_tokens');
  });
});
