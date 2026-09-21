import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileMemorySystem } from '../../../src/memory/file-memory-system.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import type { Logger } from '../../../src/utils/logger.js';
import { selectRelevantMemoriesWithDecider } from '../../../src/memory/memory-relevance.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { MemoryHeader } from '../../../src/memory/memory-types.js';

function header(filename: string, description: string, mtimeMs = 1000): MemoryHeader {
  return { filename, description, type: 'user', mtimeMs } as MemoryHeader;
}

/** Answers each question by looking the filename up in the verdict map. */
function createDecider(verdicts: Record<string, { value: boolean; confidence: number }>): Decider {
  return {
    decide: vi
      .fn()
      .mockImplementation((_state: string, questions: Record<string, { instructions: string }>) => {
        const answers: Record<string, { value: boolean; confidence: number }> = {};
        for (const [key, question] of Object.entries(questions)) {
          const match = Object.keys(verdicts).find((f) => question.instructions.includes(f));
          answers[key] = match ? verdicts[match]! : { value: false, confidence: 0.9 };
        }
        return Promise.resolve(answers);
      }),
  };
}

describe('selectRelevantMemoriesWithDecider', () => {
  it('returns only the memories judged useful', async () => {
    const memories = [header('a.md', 'User prefers dark mode'), header('b.md', 'Deploy runbook')];
    const decider = createDecider({
      'a.md': { value: true, confidence: 0.9 },
      'b.md': { value: false, confidence: 0.9 },
    });

    const selected = await selectRelevantMemoriesWithDecider('what theme?', memories, decider);
    expect(selected).toEqual(['a.md']);
  });

  it('asks one question per candidate in a single round trip', async () => {
    const memories = [header('a.md', 'one'), header('b.md', 'two'), header('c.md', 'three')];
    const decider = createDecider({});

    await selectRelevantMemoriesWithDecider('query', memories, decider);

    expect(decider.decide).toHaveBeenCalledOnce();
    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toBe('query');
    expect(Object.keys(questions)).toHaveLength(3);
    expect(Object.values(questions).every((q: any) => q.kind === 'bool')).toBe(true);
  });

  it('orders results by confidence, most certain first', async () => {
    const memories = [header('low.md', 'x'), header('high.md', 'y'), header('mid.md', 'z')];
    const decider = createDecider({
      'low.md': { value: true, confidence: 0.6 },
      'high.md': { value: true, confidence: 0.99 },
      'mid.md': { value: true, confidence: 0.8 },
    });

    const selected = await selectRelevantMemoriesWithDecider('q', memories, decider);
    expect(selected).toEqual(['high.md', 'mid.md', 'low.md']);
  });

  it('caps the selection at five memories, like the LLM selector', async () => {
    const memories = Array.from({ length: 8 }, (_, i) => header(`m${i}.md`, 'x'));
    const verdicts = Object.fromEntries(
      memories.map((m, i) => [m.filename, { value: true, confidence: 0.5 + i / 100 }]),
    );

    const selected = await selectRelevantMemoriesWithDecider(
      'q',
      memories,
      createDecider(verdicts),
    );
    expect(selected).toHaveLength(5);
  });

  it('caps how many candidates go in one request, keeping the most recent', async () => {
    const memories = Array.from({ length: 80 }, (_, i) => header(`m${i}.md`, 'x', i));
    const decider = createDecider({});

    await selectRelevantMemoriesWithDecider('q', memories, decider);

    const [, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    const asked = Object.values(questions).map((q: any) => q.instructions as string);
    expect(asked).toHaveLength(50);
    // Newest memory kept, oldest dropped.
    expect(asked.some((i) => i.includes('m79.md'))).toBe(true);
    expect(asked.some((i) => i.includes('m0.md'))).toBe(false);
  });

  it('returns an empty list when there are no candidates', async () => {
    const decider = createDecider({});
    expect(await selectRelevantMemoriesWithDecider('q', [], decider)).toEqual([]);
    expect(decider.decide).not.toHaveBeenCalled();
  });

  it('propagates decider failures so the caller can fall back', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;

    await expect(
      selectRelevantMemoriesWithDecider('q', [header('a.md', 'x')], decider),
    ).rejects.toThrow('network down');
  });
});

describe('FileMemorySystem.findRelevant with a decider', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'fms-decider-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function createClient(): LLMClient {
    return {
      chat: vi.fn().mockResolvedValue({
        content: JSON.stringify({ selected_memories: ['from-llm.md'] }),
      }),
    } as unknown as LLMClient;
  }

  function createLogger(): Logger {
    return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  }

  async function seedMemory(system: FileMemorySystem, name: string, content: string) {
    await system.ensureDir();
    return system.saveMemory({ name, description: content, type: 'user', content });
  }

  it('uses the decider instead of the LLM selector', async () => {
    const client = createClient();
    const decider = {
      decide: vi.fn().mockImplementation((_s: string, questions: Record<string, unknown>) => {
        const answers: Record<string, { value: boolean; confidence: number }> = {};
        for (const key of Object.keys(questions)) answers[key] = { value: true, confidence: 0.9 };
        return Promise.resolve(answers);
      }),
    } as unknown as Decider;

    const system = new FileMemorySystem({ memoryDir: tempDir, decider }, client, createLogger());
    await seedMemory(system, 'Dark Mode', 'User prefers dark mode');

    const results = await system.findRelevant('what theme does the user like?');

    expect(decider.decide).toHaveBeenCalledOnce();
    expect(client.chat).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it('falls back to the LLM selector when the decider fails', async () => {
    const client = createClient();
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const logger = createLogger();

    const system = new FileMemorySystem({ memoryDir: tempDir, decider }, client, logger);
    await seedMemory(system, 'Dark Mode', 'User prefers dark mode');

    await system.findRelevant('what theme?');

    expect(client.chat).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('uses the LLM selector when no decider is configured', async () => {
    const client = createClient();
    const system = new FileMemorySystem({ memoryDir: tempDir }, client, createLogger());
    await seedMemory(system, 'Dark Mode', 'User prefers dark mode');

    await system.findRelevant('what theme?');

    expect(client.chat).toHaveBeenCalledOnce();
  });
});
