import { describe, it, expect, vi } from 'vitest';
import { RecordingDecider, type DecisionRecord } from '../../../src/decision/recording-decider.js';
import type { Decider, Question } from '../../../src/contracts/entities/decider.js';
import { shouldExtractWithDecider } from '../../../src/memory/extraction-gate.js';
import { shouldRetrieveKnowledge } from '../../../src/knowledge/retrieval-gate.js';
import { selectRelevantMemoriesWithDecider } from '../../../src/memory/memory-relevance.js';
import { rerankChunks } from '../../../src/knowledge/rerank.js';
import { decideSkill } from '../../../src/skills/skill-decider.js';
import { classifyToolError } from '../../../src/tools/error-classifier.js';
import { routeModel } from '../../../src/llm/model-router.js';
import type { MemoryHeader } from '../../../src/memory/memory-types.js';
import type { AgentSkill } from '../../../src/contracts/entities/agent-skill.js';

/** Answers any question shape plausibly, so every gate runs to completion. */
function permissiveDecider(): Decider {
  return {
    decide: vi.fn().mockImplementation((_state: string, questions: Record<string, Question>) => {
      const answers: Record<string, { value: unknown; confidence: number }> = {};
      for (const [key, question] of Object.entries(questions)) {
        if (question.kind === 'bool') answers[key] = { value: true, confidence: 0.9 };
        else if (question.kind === 'score') answers[key] = { value: 2.5, confidence: 0.9 };
        else answers[key] = { value: Object.keys(question.criteria)[0], confidence: 0.9 };
      }
      return Promise.resolve(answers);
    }),
  };
}

function recordOne(): { decider: Decider; rows: DecisionRecord[] } {
  const rows: DecisionRecord[] = [];
  return { decider: new RecordingDecider(permissiveDecider(), (r) => rows.push(r)), rows };
}

describe('every gate is labelled with its decision point', () => {
  it('labels memory extraction', async () => {
    const { decider, rows } = recordOne();
    await shouldExtractWithDecider('meu CNPJ e 123', 1, {}, decider);
    expect(rows[0]!.point).toBe('memory_extraction');
  });

  it('labels the knowledge gate', async () => {
    const { decider, rows } = recordOne();
    await shouldRetrieveKnowledge('qual a politica?', {}, decider);
    expect(rows[0]!.point).toBe('knowledge_gate');
  });

  it('labels memory relevance', async () => {
    const { decider, rows } = recordOne();
    const memories = [
      { filename: 'a.md', description: 'x', mtimeMs: 1 },
      { filename: 'b.md', description: 'y', mtimeMs: 2 },
    ] as MemoryHeader[];

    await selectRelevantMemoriesWithDecider('q', memories, decider);
    expect(rows[0]!.point).toBe('memory_relevance');
  });

  it('labels the knowledge rerank', async () => {
    const { decider, rows } = recordOne();
    await rerankChunks('q', [{ id: '1', content: 'a', score: 0.5 }], decider, { topK: 3 });
    expect(rows[0]!.point).toBe('knowledge_rerank');
  });

  it('labels skill activation', async () => {
    const { decider, rows } = recordOne();
    const skills = [{ name: 'blog', description: 'writes', instructions: 'x' }] as AgentSkill[];

    await decideSkill('write a post', skills, decider);
    expect(rows[0]!.point).toBe('skill_activation');
  });

  it('labels tool error classification', async () => {
    const { decider, rows } = recordOne();
    await classifyToolError(new Error('boom'), 'run_query', decider);
    expect(rows[0]!.point).toBe('tool_error');
  });

  it('labels model routing', async () => {
    const { decider, rows } = recordOne();
    await routeModel('oi', { capableModel: 'big', fastModel: 'small' }, decider);
    expect(rows[0]!.point).toBe('model_routing');
  });

  it('labels a single-candidate relevance call, not a bool gate', async () => {
    const { decider, rows } = recordOne();
    const memories = [{ filename: 'a.md', description: 'x', mtimeMs: 1 }] as MemoryHeader[];

    await selectRelevantMemoriesWithDecider('q', memories, decider);
    expect(rows[0]!.point).toBe('memory_relevance');
  });
});
