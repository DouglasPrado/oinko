import { randomUUID } from 'node:crypto';
import type { Answers, Decider, Question } from '../contracts/entities/decider.js';
import { inferDecisionPoint, type DecisionPoint } from './recording-decider.js';

type RecordedAnswers = Record<string, { value: string | number | boolean; confidence: number }>;

/** One decision taken twice — by the engine in charge and by the challenger. */
export interface ShadowRecord {
  id: string;
  timestamp: number;
  point: DecisionPoint;
  primary: RecordedAnswers;
  shadow?: RecordedAnswers;
  /** Undefined when either side failed — nothing to compare. */
  agreed?: boolean;
  primaryMs: number;
  shadowMs?: number;
  primaryError?: string;
  shadowError?: string;
}

function toRecorded(
  answers: Record<string, { value: unknown; confidence: number }>,
): RecordedAnswers {
  return Object.fromEntries(
    Object.entries(answers).map(([key, answer]) => [
      key,
      { value: answer.value as string | number | boolean, confidence: answer.confidence },
    ]),
  );
}

/** Two verdicts agree when every question got the same value. */
function sameVerdict(a: RecordedAnswers, b: RecordedAnswers): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key]?.value !== b[key]?.value) return false;
  }
  return true;
}

/**
 * Runs two deciders on the same question and logs how they compare, while the
 * primary alone decides what happens.
 *
 * This is how you evaluate a candidate engine on live traffic without letting
 * it change any behaviour: put the engine you trust as `primary`, the one
 * under evaluation as `shadow`, and read the disagreement rate afterwards.
 * Both run concurrently, so the turn waits for the slower of the two.
 */
export class ShadowDecider implements Decider {
  constructor(
    private readonly primary: Decider,
    private readonly shadow: Decider,
    private readonly sink: (record: ShadowRecord) => void,
  ) {}

  async decide<Q extends Record<string, Question>>(
    state: string,
    questions: Q,
    signal?: AbortSignal,
  ): Promise<Answers<Q>> {
    const startedAt = Date.now();
    const base = { id: randomUUID(), timestamp: startedAt, point: inferDecisionPoint(questions) };

    const timed = async (decider: Decider) => {
      const began = Date.now();
      const answers = await decider.decide(state, questions, signal);
      return { answers, ms: Date.now() - began };
    };

    const [primaryOutcome, shadowOutcome] = await Promise.allSettled([
      timed(this.primary),
      timed(this.shadow),
    ]);

    if (primaryOutcome.status === 'rejected') {
      const reason: unknown = primaryOutcome.reason;
      this.emit({
        ...base,
        primary: {},
        primaryMs: Date.now() - startedAt,
        primaryError: reason instanceof Error ? reason.message : String(reason),
        ...(shadowOutcome.status === 'fulfilled' && {
          shadow: toRecorded(shadowOutcome.value.answers),
          shadowMs: shadowOutcome.value.ms,
        }),
      });
      throw primaryOutcome.reason;
    }

    const primary = toRecorded(primaryOutcome.value.answers);

    if (shadowOutcome.status === 'fulfilled') {
      const shadow = toRecorded(shadowOutcome.value.answers);
      this.emit({
        ...base,
        primary,
        shadow,
        agreed: sameVerdict(primary, shadow),
        primaryMs: primaryOutcome.value.ms,
        shadowMs: shadowOutcome.value.ms,
      });
    } else {
      const reason: unknown = shadowOutcome.reason;
      this.emit({
        ...base,
        primary,
        primaryMs: primaryOutcome.value.ms,
        shadowError: reason instanceof Error ? reason.message : String(reason),
      });
    }

    return primaryOutcome.value.answers;
  }

  private emit(record: ShadowRecord): void {
    try {
      this.sink(record);
    } catch {
      // Instrumentation is never allowed to break a turn.
    }
  }
}
