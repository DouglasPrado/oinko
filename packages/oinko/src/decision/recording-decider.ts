import { createHash, randomUUID } from 'node:crypto';
import type { Answers, Decider, Question } from '../contracts/entities/decider.js';

/** Where in the harness a decision was taken. */
export type DecisionPoint =
  | 'turn_screening'
  | 'jailbreak_screening'
  | 'memory_extraction'
  | 'memory_relevance'
  | 'knowledge_gate'
  | 'knowledge_rerank'
  | 'skill_activation'
  | 'tool_error'
  | 'model_routing'
  | 'unknown';

/**
 * Question keys each call site uses. Renaming a key in a gate without
 * updating this map only costs a row labelled `unknown` — the decision itself
 * is unaffected. `tests/unit/decision/decision-points.test.ts` drives the real
 * gates through here so the mapping cannot drift silently.
 */
const SINGLE_KEY_POINTS: Record<string, DecisionPoint> = {
  needsKnowledge: 'knowledge_gate',
  skill: 'skill_activation',
  kind: 'tool_error',
  tier: 'model_routing',
  jailbreak: 'jailbreak_screening',
};

/**
 * Combinations asked in a single request. `screenTurn` bundles routing and
 * jailbreak because both judge the same message at the same moment; the log
 * needs a name for that pair or it reads as `unknown`.
 */
const COMBINED_POINTS: { keys: string[]; point: DecisionPoint }[] = [
  { keys: ['jailbreak', 'tier'], point: 'turn_screening' },
];

/**
 * Points whose every key matches a pattern: one question per candidate, or one
 * per side of a turn.
 */
const INDEXED_KEY_POINTS: { prefix: RegExp; point: DecisionPoint }[] = [
  { prefix: /^durableFrom/, point: 'memory_extraction' },
  { prefix: /^m\d+$/, point: 'memory_relevance' },
  { prefix: /^c\d+$/, point: 'knowledge_rerank' },
];

export function inferDecisionPoint(questions: Record<string, Question>): DecisionPoint {
  const keys = Object.keys(questions);
  if (keys.length === 0) return 'unknown';

  const single = keys.length === 1 ? SINGLE_KEY_POINTS[keys[0]!] : undefined;
  if (single) return single;

  const sorted = [...keys].sort().join(',');
  const combined = COMBINED_POINTS.find((entry) => entry.keys.join(',') === sorted);
  if (combined) return combined.point;

  for (const { prefix, point } of INDEXED_KEY_POINTS) {
    if (keys.every((key) => prefix.test(key))) return point;
  }

  return 'unknown';
}

/** One decision, as written to the log. */
export interface DecisionRecord {
  id: string;
  timestamp: number;
  point: DecisionPoint;
  /** Present only with `stateMode: 'full'`. */
  state?: string;
  /** Short digest — lets you group and dedupe without storing user content. */
  stateHash?: string;
  questions: Record<string, { kind: string; instructions: string }>;
  answers: Record<
    string,
    { value: string | number | boolean; confidence: number; probabilities?: Record<string, number> }
  >;
  durationMs: number;
  error?: string;
}

/**
 * How much of the evaluated state reaches the log.
 *
 * The state is whatever the user typed, so the default keeps a digest only.
 * Use `full` solely in an environment where storing that content is allowed
 * and intended — a rotulation run on your own fixtures, not production.
 */
export type StateMode = 'omit' | 'hash' | 'full';

export interface RecordingOptions {
  stateMode?: StateMode;
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex').slice(0, 16);
}

/**
 * Wraps a decider and logs every decision it takes.
 *
 * Adds no behaviour: answers pass through untouched, and a sink that throws is
 * swallowed — instrumentation must never be the reason a turn fails.
 */
export class RecordingDecider implements Decider {
  private readonly stateMode: StateMode;

  constructor(
    private readonly inner: Decider,
    private readonly sink: (record: DecisionRecord) => void,
    options?: RecordingOptions,
  ) {
    this.stateMode = options?.stateMode ?? 'hash';
  }

  async decide<Q extends Record<string, Question>>(
    state: string,
    questions: Q,
    signal?: AbortSignal,
  ): Promise<Answers<Q>> {
    const startedAt = Date.now();
    const base = {
      id: randomUUID(),
      timestamp: startedAt,
      point: inferDecisionPoint(questions),
      ...(this.stateMode === 'full' && { state }),
      ...(this.stateMode === 'hash' && { stateHash: hashState(state) }),
      questions: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => [
          key,
          { kind: question.kind, instructions: question.instructions },
        ]),
      ),
    };

    try {
      const answers = await this.inner.decide(state, questions, signal);

      // Answers<Q> is a mapped type, so iterating it generically loses the
      // per-question variant; the shape is still {value, confidence}.
      const entries = Object.entries(answers) as [
        string,
        {
          value: string | number | boolean;
          confidence: number;
          probabilities?: Record<string, number>;
        },
      ][];

      this.emit({
        ...base,
        answers: Object.fromEntries(
          entries.map(([key, answer]) => [
            key,
            {
              value: answer.value,
              confidence: answer.confidence,
              // Kept so calibration can be checked against the real
              // distribution, not just the reported confidence.
              ...(answer.probabilities !== undefined && { probabilities: answer.probabilities }),
            },
          ]),
        ),
        durationMs: Date.now() - startedAt,
      });
      return answers;
    } catch (error) {
      this.emit({
        ...base,
        answers: {},
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private emit(record: DecisionRecord): void {
    try {
      this.sink(record);
    } catch {
      // Instrumentation is never allowed to break a turn.
    }
  }
}
