import { describe, it, expect, vi } from 'vitest';
import { decideSkill, NO_SKILL } from '../../../src/skills/skill-decider.js';
import type { Decider } from '../../../src/contracts/entities/decider.js';
import type { AgentSkill } from '../../../src/contracts/entities/agent-skill.js';
import type { Logger } from '../../../src/utils/logger.js';
import { SkillManager } from '../../../src/skills/skill-manager.js';
import type { EmbeddingService } from '../../../src/knowledge/embedding-service.js';

function skill(name: string, description: string, extra: Partial<AgentSkill> = {}): AgentSkill {
  return { name, description, instructions: 'do it', ...extra };
}

function createDecider(choice: string, confidence = 0.9): Decider {
  return {
    decide: vi.fn().mockResolvedValue({ skill: { value: choice, confidence } }),
  };
}

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('decideSkill', () => {
  it('returns the chosen skill', async () => {
    const skills = [skill('blog', 'Write blog posts'), skill('deploy', 'Deploy the app')];
    const result = await decideSkill('publish an article', skills, createDecider('blog'));

    expect(result).toHaveLength(1);
    expect(result[0]!.skill.name).toBe('blog');
    expect(result[0]!.matchType).toBe('semantic');
  });

  it('returns nothing when the decider picks none', async () => {
    const skills = [skill('blog', 'Write blog posts')];
    const result = await decideSkill('bom dia', skills, createDecider(NO_SKILL));

    expect(result).toEqual([]);
  });

  it('returns nothing when confidence is below the floor', async () => {
    const skills = [skill('blog', 'Write blog posts')];
    const result = await decideSkill('talvez', skills, createDecider('blog', 0.3));

    expect(result).toEqual([]);
  });

  it('only offers skills that lack explicit matchers', async () => {
    const skills = [
      skill('blog', 'Write blog posts'),
      skill('prefixed', 'Has a prefix', { triggerPrefix: '/p' }),
      skill('aliased', 'Has aliases', { aliases: ['/a'] }),
      skill('custom', 'Has a matcher', { match: () => true }),
    ];
    const decider = createDecider(NO_SKILL);

    await decideSkill('input', skills, decider);

    const [, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    const criteria = questions.skill.criteria as Record<string, string>;
    expect(Object.keys(criteria).sort()).toEqual([NO_SKILL, 'blog'].sort());
  });

  it('asks a single choice question including the none option', async () => {
    const skills = [skill('blog', 'Write blog posts', { whenToUse: 'when writing content' })];
    const decider = createDecider('blog');

    await decideSkill('write something', skills, decider);

    expect(decider.decide).toHaveBeenCalledOnce();
    const [state, questions] = (decider.decide as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(state).toBe('write something');
    expect(questions.skill.kind).toBe('choice');
    expect(questions.skill.criteria[NO_SKILL]).toBeDefined();
    expect(questions.skill.criteria.blog).toContain('when writing content');
  });

  it('returns nothing without calling the decider when no skill is eligible', async () => {
    const decider = createDecider(NO_SKILL);
    const skills = [skill('prefixed', 'x', { triggerPrefix: '/p' })];

    expect(await decideSkill('input', skills, decider)).toEqual([]);
    expect(decider.decide).not.toHaveBeenCalled();
  });

  it('ignores a choice that does not map to a known skill', async () => {
    const skills = [skill('blog', 'Write blog posts')];
    const logger = createLogger();

    const result = await decideSkill('x', skills, createDecider('ghost'), { logger });

    expect(result).toEqual([]);
  });

  it('propagates decider failures so the caller can fall back', async () => {
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;

    await expect(decideSkill('x', [skill('blog', 'y')], decider)).rejects.toThrow('network down');
  });
});

describe('SkillManager routing to the decider', () => {
  function createEmbeddings(): EmbeddingService {
    return {
      embedSingle: vi.fn().mockResolvedValue(new Float32Array([0.1, 0.2])),
    } as unknown as EmbeddingService;
  }

  it('decides without spending any embedding', async () => {
    const embeddingService = createEmbeddings();
    const decider = createDecider('blog');
    const manager = new SkillManager({ embeddingService, decider, logger: createLogger() });
    manager.register(skill('blog', 'Write blog posts'));

    const matches = await manager.match('publish an article', { threadId: 't1' });

    expect(decider.decide).toHaveBeenCalledOnce();
    expect(embeddingService.embedSingle).not.toHaveBeenCalled();
    expect(matches.map((m) => m.name)).toEqual(['blog']);
  });

  it('does not fall back to embeddings when the decider answers none', async () => {
    const embeddingService = createEmbeddings();
    const decider = createDecider(NO_SKILL);
    const manager = new SkillManager({ embeddingService, decider, logger: createLogger() });
    manager.register(skill('blog', 'Write blog posts'));

    const matches = await manager.match('bom dia', { threadId: 't1' });

    expect(matches).toEqual([]);
    expect(embeddingService.embedSingle).not.toHaveBeenCalled();
  });

  it('falls back to semantic matching when the decider fails', async () => {
    const embeddingService = createEmbeddings();
    const decider = {
      decide: vi.fn().mockRejectedValue(new Error('network down')),
    } as unknown as Decider;
    const logger = createLogger();
    const manager = new SkillManager({ embeddingService, decider, logger });
    manager.register(skill('blog', 'Write blog posts'));

    await manager.match('publish an article', { threadId: 't1' });

    expect(embeddingService.embedSingle).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('keeps using embeddings when no decider is configured', async () => {
    const embeddingService = createEmbeddings();
    const manager = new SkillManager({ embeddingService });
    manager.register(skill('blog', 'Write blog posts'));

    await manager.match('publish an article', { threadId: 't1' });

    expect(embeddingService.embedSingle).toHaveBeenCalled();
  });
});
