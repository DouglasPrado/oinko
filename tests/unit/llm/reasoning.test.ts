import { describe, it, expect } from 'vitest';
import {
  isReasoningModel,
  buildReasoningArgs,
  requiresNoSystemRole,
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
    expect(buildReasoningArgs('gpt-6-astra', false)).toHaveProperty('temperature', undefined);
  });

  it('leaves non-reasoning models untouched', () => {
    expect(buildReasoningArgs('gpt-4o', true)).toEqual({});
  });

  /**
   * /chat/completions rejects function tools combined with a reasoning budget:
   * "Function tools with reasoning_effort are not supported". Asking for no
   * effort is what keeps tool calling working on this endpoint.
   */
  it('asks for no reasoning effort when a reasoning model gets tools', () => {
    expect(buildReasoningArgs('gpt-6-astra', true)).toMatchObject({ reasoningEffort: 'none' });
  });

  it('does not set the effort when there are no tools', () => {
    expect(buildReasoningArgs('gpt-6-astra', false)).not.toHaveProperty('reasoningEffort');
  });

  it('never sets the effort for a non-reasoning model', () => {
    expect(buildReasoningArgs('gpt-4o', true)).not.toHaveProperty('reasoningEffort');
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

  it('disables reasoning effort when a reasoning model is given tools', async () => {
    const body = await captureBody('gpt-6-astra', TOOL);
    expect(body.reasoning_effort).toBe('none');
  });

  /**
   * The internal name is camelCase; the wire name is snake_case. Spreading the
   * internal object into the body once leaked `reasoningEffort` alongside the
   * correct key, and the provider rejected the whole request with
   * "Unknown parameter". Asserting presence was not enough — absence matters.
   */
  it('never leaks the internal camelCase name onto the wire', async () => {
    const withTools = await captureBody('gpt-6-astra', TOOL);
    const withoutTools = await captureBody('gpt-6-astra');
    const chatModel = await captureBody('gpt-4o', TOOL);

    for (const body of [withTools, withoutTools, chatModel]) {
      expect(body).not.toHaveProperty('reasoningEffort');
    }
  });

  it('sends no unknown parameters for a reasoning model with tools', async () => {
    const body = await captureBody('gpt-6-astra', TOOL);
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
    const body = await captureBody('gpt-6-astra', TOOL);
    expect(body.max_completion_tokens).toBe(100);
    expect(body).not.toHaveProperty('max_tokens');
  });
});
