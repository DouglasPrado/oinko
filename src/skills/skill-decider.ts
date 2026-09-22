import type { Decider } from '../contracts/entities/decider.js';
import type { AgentSkill } from '../contracts/entities/agent-skill.js';
// Type-only import: erased at build time, so no runtime cycle with skill-manager.
import type { SkillMatchResult } from './skill-manager.js';
import type { Logger } from '../utils/logger.js';

/** Sentinel option meaning "no skill fits this input". */
export const NO_SKILL = '__none__';

/** Minimum confidence to activate a skill on a decision. */
const DEFAULT_MIN_CONFIDENCE = 0.6;

export interface SkillDeciderOptions {
  minConfidence?: number;
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Pick a skill for the input with a single typed choice.
 *
 * The embedding matcher this replaces costs one embedding for the input plus
 * one per candidate skill, every turn it runs. A choice question costs one
 * call regardless of how many skills are registered.
 *
 * Only skills without explicit matchers are offered — a prefix, alias or
 * custom `match()` already decided the question deterministically, and those
 * paths run before this one.
 *
 * Results keep `matchType: 'semantic'`: this is still a match by meaning, and
 * reusing the value avoids widening a public union type.
 *
 * Throws when the decider is unreachable, so the caller can fall back to
 * embeddings.
 */
export async function decideSkill(
  input: string,
  eligible: readonly AgentSkill[],
  decider: Decider,
  options?: SkillDeciderOptions,
): Promise<SkillMatchResult[]> {
  const candidates = eligible.filter(
    (skill) => !skill.triggerPrefix && !skill.aliases?.length && !skill.match,
  );
  if (candidates.length === 0) return [];

  const criteria: Record<string, string> = {
    [NO_SKILL]: 'None of these skills applies — handle the message normally.',
  };
  for (const skill of candidates) {
    criteria[skill.name] = skill.whenToUse
      ? `${skill.description}. Use when: ${skill.whenToUse}`
      : skill.description;
  }

  const answers = await decider.decide(
    input,
    {
      skill: {
        kind: 'choice',
        instructions: 'Which skill should handle this message?',
        criteria,
      },
    },
    options?.signal,
  );

  const { value, confidence } = answers.skill;
  if (value === NO_SKILL) return [];
  if (confidence < (options?.minConfidence ?? DEFAULT_MIN_CONFIDENCE)) return [];

  const chosen = candidates.find((skill) => skill.name === value);
  if (!chosen) {
    options?.logger?.warn('Decider chose an unknown skill — ignoring', { choice: String(value) });
    return [];
  }

  return [{ skill: chosen, matchType: 'semantic', score: confidence }];
}
