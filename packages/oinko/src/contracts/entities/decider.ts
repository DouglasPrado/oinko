/**
 * Pluggable decision engine — answers typed questions about a state.
 *
 * Unlike the LLM client, a decider never returns prose: every answer is a
 * typed value carrying a calibrated confidence. It exists for in-loop
 * decisions that would otherwise cost a full model call or fall back to a
 * blind heuristic (random sampling, fixed thresholds).
 *
 * The interface is provider-agnostic — SQLite is to `VectorStore` what Jev is
 * to `Decider`. Any engine that can answer bool/choice/score questions fits.
 */

/** A yes/no question. */
export interface BoolQuestion {
  kind: 'bool';
  instructions: string;
  /** Optional descriptions of what each verdict means. */
  criteria?: { true: string; false: string };
}

/** A pick-one question. `criteria` maps each option to its description. */
export interface ChoiceQuestion {
  kind: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/** An ordered-scale question. `criteria` lists the levels, lowest first. */
export interface ScoreQuestion {
  kind: 'score';
  instructions: string;
  criteria: readonly string[];
}

export type Question = BoolQuestion | ChoiceQuestion | ScoreQuestion;

/** A typed answer with the engine's calibrated confidence (0..1). */
export interface Decision<T> {
  value: T;
  confidence: number;
  /**
   * Probability the engine assigned to each option, when it reports them.
   *
   * `confidence` and the chosen option's probability are not the same number,
   * so keeping both is what lets you check whether a threshold on
   * `confidence` means what you assume it means.
   */
  probabilities?: Record<string, number>;
}

/** Maps a question to the shape of its answer — a choice yields its own options. */
export type Answer<Q extends Question> = Q extends BoolQuestion
  ? Decision<boolean>
  : Q extends { kind: 'choice'; criteria: infer C }
    ? Decision<Extract<keyof C, string>>
    : Q extends ScoreQuestion
      ? Decision<number>
      : never;

export const DECISION_USAGE: unique symbol = Symbol('decision-usage');
export interface DecisionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
export type Answers<Q extends Record<string, Question>> = {
  [K in keyof Q]: Answer<Q[K]>;
} & { [DECISION_USAGE]?: DecisionUsage };

export interface Decider {
  /**
   * Answers every question about the same state in a single round trip.
   * Batching matters: decisions taken at the same point in the loop should
   * travel together rather than serialise their latency.
   */
  decide<Q extends Record<string, Question>>(
    state: string,
    questions: Q,
    signal?: AbortSignal,
  ): Promise<Answers<Q>>;
}
