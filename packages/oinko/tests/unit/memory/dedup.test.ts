import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileMemorySystem } from '../../../src/memory/file-memory-system.js';
import type { LLMClient } from '../../../src/llm/llm-client.js';
import { findDuplicateMemory, NO_DUPLICATE } from '../../../src/memory/dedup.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { MemoryHeader } from '../../../src/memory/memory-types.js';
import type { Logger } from '../../../src/utils/logger.js';

function header(filename: string, description: string, mtimeMs = 1): MemoryHeader {
  return { filename, description, name: filename, type: 'user', mtimeMs } as MemoryHeader;
}

function createDecider(choice: string, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ duplicate: { value: choice, confidence } }),
  };
}

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

const EXISTING = [
  header('dark-mode.md', 'User prefers dark mode'),
  header('deploy-runbook.md', 'How to deploy the app'),
];

describe('findDuplicateMemory', () => {
  it('names the memory that already covers the topic', async () => {
    const found = await findDuplicateMemory(
      { name: 'Theme preference', description: 'User likes dark themes' },
      EXISTING,
      createDecider('dark-mode.md'),
    );

    expect(found).toBe('dark-mode.md');
  });

  it('returns null when nothing covers it', async () => {
    const found = await findDuplicateMemory(
      { name: 'Timezone', description: 'User is in UTC-3' },
      EXISTING,
      createDecider(NO_DUPLICATE),
    );

    expect(found).toBeNull();
  });

  it('ignores a low-confidence match — a wrong merge loses a memory', async () => {
    const found = await findDuplicateMemory(
      { name: 'Theme', description: 'something vaguely related' },
      EXISTING,
      createDecider('dark-mode.md', 0.5),
    );

    expect(found).toBeNull();
  });

  it('offers every existing memory plus the none option', async () => {
    const decider = createDecider(NO_DUPLICATE);
    await findDuplicateMemory({ name: 'x', description: 'y' }, EXISTING, decider);

    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toContain('x');
    expect(state).toContain('y');
    expect(questions.duplicate.kind).toBe('choice');
    expect(Object.keys(questions.duplicate.criteria).sort()).toEqual(
      [NO_DUPLICATE, 'dark-mode.md', 'deploy-runbook.md'].sort(),
    );
  });

  it('returns null without asking when there is nothing to compare against', async () => {
    const decider = createDecider(NO_DUPLICATE);

    expect(await findDuplicateMemory({ name: 'x', description: 'y' }, [], decider)).toBeNull();
    expect(decider.decide).not.toHaveBeenCalled();
  });

  it('ignores a choice that is not one of the candidates', async () => {
    const found = await findDuplicateMemory(
      { name: 'x', description: 'y' },
      EXISTING,
      createDecider('ghost.md'),
      { logger: createLogger() },
    );

    expect(found).toBeNull();
  });

  it('returns null when the decider fails — writing a duplicate beats losing the memory', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const logger = createLogger();

    const found = await findDuplicateMemory({ name: 'x', description: 'y' }, EXISTING, decider, {
      logger,
    });

    expect(found).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('caps how many candidates go in one request, keeping the most recent', async () => {
    const many = Array.from({ length: 60 }, (_, i) => header(`m${i}.md`, 'x', i));
    const decider = createDecider(NO_DUPLICATE);

    await findDuplicateMemory({ name: 'x', description: 'y' }, many, decider);

    const [, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    const options = Object.keys(questions.duplicate.criteria as Record<string, string>);
    expect(options).toHaveLength(41); // 40 candidatos + a opcao "nenhum"
    expect(options).toContain('m59.md');
    expect(options).not.toContain('m0.md');
  });
});

describe('FileMemorySystem consolidating duplicates on save', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'dedup-fms-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function client(): LLMClient {
    return { chat: vi.fn() } as unknown as LLMClient;
  }

  it('writes over the memory the decider points at', async () => {
    const system = new FileMemorySystem({ memoryDir: tempDir }, client(), createLogger());
    const first = await system.saveMemory({
      name: 'Dark Mode',
      description: 'User prefers dark mode',
      type: 'user',
      content: 'User prefers dark mode',
    });

    const deduping = new FileMemorySystem(
      { memoryDir: tempDir, decider: createDecider(first) },
      client(),
      createLogger(),
    );
    const second = await deduping.saveMemory({
      name: 'Theme Preference',
      description: 'User likes dark themes',
      type: 'user',
      content: 'User likes dark themes, confirmed again',
    });

    expect(second).toBe(first);
    const all = await deduping.scanMemories();
    expect(all).toHaveLength(1);
  });

  it('writes a new file when nothing matches', async () => {
    const system = new FileMemorySystem(
      { memoryDir: tempDir, decider: createDecider(NO_DUPLICATE) },
      client(),
      createLogger(),
    );

    await system.saveMemory({
      name: 'Dark Mode',
      description: 'prefers dark mode',
      type: 'user',
      content: 'a',
    });
    await system.saveMemory({
      name: 'Timezone',
      description: 'is in UTC-3',
      type: 'user',
      content: 'b',
    });

    expect(await system.scanMemories()).toHaveLength(2);
  });

  it('keeps every memory when no decider is configured', async () => {
    const system = new FileMemorySystem({ memoryDir: tempDir }, client(), createLogger());

    await system.saveMemory({ name: 'A', description: 'x', type: 'user', content: 'a' });
    await system.saveMemory({ name: 'B', description: 'x', type: 'user', content: 'b' });

    expect(await system.scanMemories()).toHaveLength(2);
  });
});
