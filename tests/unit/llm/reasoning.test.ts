import { describe, it, expect } from 'vitest';
import {
  isReasoningModel,
  buildReasoningArgs,
  requiresNoSystemRole,
  rejectsToolsOnChatCompletions,
  toolsRequireEffortNone,
} from '../../../src/llm/reasoning.js';
import { LLMClient } from '../../../src/llm/llm-client.js';
import type { ReasoningEffort } from '../../../src/llm/message-types.js';

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
    expect(buildReasoningArgs('gpt-6-astra', {}).dropTemperature).toBe(true);
    expect(buildReasoningArgs('gpt-5.5', {}).dropTemperature).toBe(true);
    expect(buildReasoningArgs('o3', {}).dropTemperature).toBe(true);
  });

  it('leaves non-reasoning models untouched', () => {
    expect(buildReasoningArgs('gpt-4o', { hasTools: true })).toEqual({ dropTemperature: false });
  });

  /**
   * Probed live: the gpt-5.4 line is the one reasoning family that takes a
   * non-default temperature on /chat/completions. The others answer
   * "Only the default (1) value is supported".
   */
  it('keeps temperature for the family that accepts it', () => {
    expect(buildReasoningArgs('gpt-5.4', {}).dropTemperature).toBe(false);
    expect(buildReasoningArgs('gpt-5.4-mini', {}).dropTemperature).toBe(false);
    expect(buildReasoningArgs('gpt-5.4-nano', {}).dropTemperature).toBe(false);
  });

  /**
   * Temperature is refused because reasoning is on, not because of the model
   * id: with the budget at zero the same model takes it. Probed on gpt-5.5
   * and gpt-5.6 alike.
   */
  it("keeps temperature once the effort resolves to 'none'", () => {
    expect(buildReasoningArgs('gpt-5.6', { hasTools: true }).dropTemperature).toBe(false);
    expect(buildReasoningArgs('gpt-5.5', { reasoningEffort: 'none' }).dropTemperature).toBe(false);
    expect(buildReasoningArgs('gpt-5.6', { reasoningEffort: 'high' }).dropTemperature).toBe(true);
  });

  /**
   * Probed live against the OpenAI API: the gpt-5.6 line takes function tools
   * on /chat/completions only with `reasoning_effort: 'none'` — any other
   * value, and the absence of the field, both draw a 400. So this is the one
   * case where the client sets an effort by itself.
   */
  it("sets effort 'none' for the gpt-5.6 line when tools are present", () => {
    expect(buildReasoningArgs('gpt-5.6', { hasTools: true }).reasoningEffort).toBe('none');
    expect(buildReasoningArgs('openai/gpt-5.6-luna', { hasTools: true }).reasoningEffort).toBe(
      'none',
    );
  });

  it('leaves effort alone for the gpt-5.6 line without tools', () => {
    expect(buildReasoningArgs('gpt-5.6', {}).reasoningEffort).toBeUndefined();
  });

  it('never sets a reasoning effort for the other families', () => {
    for (const model of ['gpt-6-astra', 'gpt-5.4', 'gpt-5.5', 'gpt-4o']) {
      expect(buildReasoningArgs(model, { hasTools: true }).reasoningEffort).toBeUndefined();
    }
  });

  it('echoes back an explicit caller effort instead of the automatic one', () => {
    expect(buildReasoningArgs('gpt-5.6', { hasTools: true, reasoningEffort: 'xhigh' })
      .reasoningEffort).toBe('xhigh');
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

describe('toolsRequireEffortNone', () => {
  it('flags the line that takes tools only with effort none', () => {
    expect(toolsRequireEffortNone('gpt-5.6')).toBe(true);
    expect(toolsRequireEffortNone('gpt-5.6-luna')).toBe(true);
    expect(toolsRequireEffortNone('gpt-5.6-sol')).toBe(true);
    expect(toolsRequireEffortNone('gpt-5.6-terra')).toBe(true);
    expect(toolsRequireEffortNone('openai/gpt-5.6')).toBe(true);
  });

  it('leaves the other families alone', () => {
    expect(toolsRequireEffortNone('gpt-6-astra')).toBe(false);
    expect(toolsRequireEffortNone('gpt-5.5')).toBe(false);
    expect(toolsRequireEffortNone('gpt-5.4')).toBe(false);
    expect(toolsRequireEffortNone('gpt-4o')).toBe(false);
    expect(toolsRequireEffortNone('anthropic/claude-sonnet-5')).toBe(false);
  });
});

describe('rejectsToolsOnChatCompletions', () => {
  /**
   * Only the gpt-6 line is left here. The gpt-5.6 line was flagged too until a
   * live probe showed it does take tools with `reasoning_effort: 'none'` — the
   * value gpt-6 itself rejects as unsupported.
   */
  it('flags the line that only takes tools via /v1/responses', () => {
    expect(rejectsToolsOnChatCompletions('gpt-6-astra')).toBe(true);
    expect(rejectsToolsOnChatCompletions('openai/gpt-6-astra-pro')).toBe(true);
  });

  it('leaves models that do accept tools alone', () => {
    expect(rejectsToolsOnChatCompletions('gpt-5.6')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.6-luna')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.6-sol')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.6-terra')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.5')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.4')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-5.4-mini')).toBe(false);
    expect(rejectsToolsOnChatCompletions('gpt-4o')).toBe(false);
    expect(rejectsToolsOnChatCompletions('anthropic/claude-sonnet-5')).toBe(false);
  });
});

describe('LLMClient request body for reasoning models', () => {
  interface Extras {
    tools?: {
      type: 'function';
      function: { name: string; description: string; parameters: object };
    }[];
    reasoningEffort?: ReasoningEffort;
    temperature?: number;
  }

  async function captureBody(model: string, extras: Extras = {}): Promise<Record<string, unknown>> {
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
      ...extras,
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
    await expect(captureBody('gpt-6-astra', { tools: TOOL })).rejects.toThrow(
      /does not accept function tools on \/chat\/completions/,
    );
  });

  it('sends no reasoning_effort for a model that accepts tools', async () => {
    const body = await captureBody('gpt-5.4', { tools: TOOL });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(body.tools).toBeDefined();
  });

  it("sends effort 'none' with the tools for the gpt-5.6 line", async () => {
    const body = await captureBody('gpt-5.6', { tools: TOOL });
    expect(body.reasoning_effort).toBe('none');
    expect(body.tools).toBeDefined();
  });

  it('sends no reasoning_effort for the gpt-5.6 line without tools', async () => {
    const body = await captureBody('gpt-5.6');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  /**
   * The automatic 'none' is a floor, not a ceiling: a caller that names an
   * effort has said something the client should not quietly overwrite. The
   * provider then decides — and its 400 for this combination is accurate.
   */
  it('lets an explicit caller effort win over the automatic none', async () => {
    const body = await captureBody('gpt-5.6', { tools: TOOL, reasoningEffort: 'high' });
    expect(body.reasoning_effort).toBe('high');
  });

  /**
   * The internal name is camelCase; the wire name is snake_case. Spreading the
   * internal object into the body once leaked `reasoningEffort` alongside the
   * correct key, and the provider rejected the whole request with
   * "Unknown parameter". Asserting presence was not enough — absence matters.
   */
  it('never leaks the internal camelCase name onto the wire', async () => {
    const withTools = await captureBody('gpt-5.4', { tools: TOOL });
    const withoutTools = await captureBody('gpt-6-astra');
    const chatModel = await captureBody('gpt-4o', { tools: TOOL });
    const autoNone = await captureBody('gpt-5.6', { tools: TOOL });

    for (const body of [withTools, withoutTools, chatModel, autoNone]) {
      expect(body).not.toHaveProperty('reasoningEffort');
    }
  });

  it('sends no unknown parameters for a reasoning model with tools', async () => {
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

    for (const model of ['gpt-5.4', 'gpt-5.6']) {
      const body = await captureBody(model, { tools: TOOL });
      expect(Object.keys(body).filter((k) => !allowed.has(k))).toEqual([]);
    }
  });

  it('omits the field when the model has no tools', async () => {
    const body = await captureBody('gpt-6-astra');
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  it('omits the field for non-reasoning models', async () => {
    const body = await captureBody('gpt-4o', { tools: TOOL });
    expect(body).not.toHaveProperty('reasoning_effort');
  });

  /**
   * `autocompact` and `memory-relevance` both send `temperature: 0` with
   * whatever model the agent runs. Until this was fixed the value went out as
   * given and the provider answered 400 for every reasoning model — the two
   * subsystems were dead on the whole gpt-5 line.
   */
  it('drops a caller temperature the model would refuse', async () => {
    for (const model of ['gpt-5.6', 'gpt-5.5', 'gpt-5', 'gpt-6-astra', 'o3']) {
      const body = await captureBody(model, { temperature: 0 });
      expect(body, model).not.toHaveProperty('temperature');
    }
  });

  it('keeps a caller temperature the model accepts', async () => {
    expect((await captureBody('gpt-4o', { temperature: 0 })).temperature).toBe(0);
    expect((await captureBody('gpt-5.4', { temperature: 0 })).temperature).toBe(0);
    expect((await captureBody('gpt-5.4-mini', { temperature: 0.7 })).temperature).toBe(0.7);
  });

  it('keeps the temperature when reasoning is off anyway', async () => {
    const withTools = await captureBody('gpt-5.6', { tools: TOOL, temperature: 0 });
    expect(withTools.temperature).toBe(0);
    expect(withTools.reasoning_effort).toBe('none');

    const explicit = await captureBody('gpt-5.5', { temperature: 0, reasoningEffort: 'none' });
    expect(explicit.temperature).toBe(0);
  });

  it("accepts 'xhigh' as a reasoning effort", async () => {
    const body = await captureBody('gpt-5.6', { reasoningEffort: 'xhigh' });
    expect(body.reasoning_effort).toBe('xhigh');
  });

  it('uses max_completion_tokens for the gpt-6 line', async () => {
    const body = await captureBody('gpt-6-astra');
    expect(body.max_completion_tokens).toBe(100);
    expect(body).not.toHaveProperty('max_tokens');
  });
});
