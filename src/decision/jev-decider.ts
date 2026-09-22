import type { Answers, Decider, Decision, Question } from '../contracts/entities/decider.js';
import { retry } from '../utils/retry.js';

const DEFAULT_BASE_URL = 'https://api.typesafe.ai/v1';
const DEFAULT_MODEL = 'jev-latest';
const DEFAULT_TIMEOUT = 5_000;
const DEFAULT_MAX_RETRIES = 2;

/** Transient statuses worth retrying — everything else is a client error. */
const RETRYABLE_STATUS = new Set([429, 529]);

export interface JevDeciderOptions {
  apiKey: string;
  /** Defaults to the TypeSafe System One endpoint. */
  baseUrl?: string;
  /** Defaults to `jev-latest`. */
  model?: string;
  /** Per-request timeout in ms. Default 5000. */
  timeout?: number;
  maxRetries?: number;
  initialDelay?: number;
  /** Injectable handler — same shape the Agent accepts, so a gateway can sit in front. */
  fetch?: (request: Request) => Promise<Response>;
}

export class JevError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'JevError';
  }
}

/** Wire shape of a question, per the System One API. */
function toWireQuestion(question: Question): Record<string, unknown> {
  switch (question.kind) {
    case 'bool':
      return {
        type: 'noul',
        instructions: question.instructions,
        ...(question.criteria !== undefined && { criteria: question.criteria }),
      };
    case 'choice':
      return {
        type: 'choice',
        instructions: question.instructions,
        criteria: question.criteria,
      };
    case 'score':
      return {
        type: 'score',
        instructions: question.instructions,
        criteria: question.criteria,
      };
  }
}

interface WireAnswer {
  type?: string;
  noul?: number;
  choice?: string;
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}

/**
 * A `noul` answer is itself the probability of "yes" — there is no separate
 * confidence field, so the distance from the midpoint is the confidence.
 */
function toDecision(name: string, raw: unknown): Decision<unknown> {
  if (raw === null || typeof raw !== 'object') {
    throw new JevError(`Jev returned no answer for question "${name}"`, 200);
  }
  const answer = raw as WireAnswer;

  if (answer.type === 'noul' || typeof answer.noul === 'number') {
    const probability = answer.noul;
    if (typeof probability !== 'number') {
      throw new JevError(`Jev returned a malformed noul answer for "${name}"`, 200);
    }
    const value = probability >= 0.5;
    return { value, confidence: value ? probability : 1 - probability };
  }

  if (answer.type === 'choice' || typeof answer.choice === 'string') {
    if (typeof answer.choice !== 'string') {
      throw new JevError(`Jev returned a malformed choice answer for "${name}"`, 200);
    }
    return {
      value: answer.choice,
      confidence: answer.confidence ?? 0,
      ...(answer.probabilities !== undefined && { probabilities: answer.probabilities }),
    };
  }

  if (answer.type === 'score' || typeof answer.score === 'number') {
    if (typeof answer.score !== 'number') {
      throw new JevError(`Jev returned a malformed score answer for "${name}"`, 200);
    }
    return {
      value: answer.score,
      confidence: answer.confidence ?? 0,
      ...(answer.probabilities !== undefined && { probabilities: answer.probabilities }),
    };
  }

  throw new JevError(`Jev returned an unknown answer type for "${name}"`, 200);
}

/**
 * Decider backed by TypeSafe AI's Jev (System One) model.
 *
 * Talks HTTP with native `fetch` — no SDK, so the package keeps its
 * dependency budget. Everything provider-specific lives in this file: swap it
 * for another `Decider` and the rest of the harness does not notice.
 */
export class JevDecider implements Decider {
  private readonly endpoint: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly initialDelay: number;
  private readonly fetchImpl: (request: Request) => Promise<Response>;

  constructor(private readonly options: JevDeciderOptions) {
    const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.endpoint = `${baseUrl}/systemone`;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.initialDelay = options.initialDelay ?? 1_000;
    this.fetchImpl = options.fetch ?? ((request) => globalThis.fetch(request));
  }

  async decide<Q extends Record<string, Question>>(
    state: string,
    questions: Q,
    signal?: AbortSignal,
  ): Promise<Answers<Q>> {
    const body = JSON.stringify({
      state,
      model: this.model,
      questions: Object.fromEntries(
        Object.entries(questions).map(([name, question]) => [name, toWireQuestion(question)]),
      ),
    });

    const payload = await retry(() => this.post(body, signal), {
      maxRetries: this.maxRetries,
      initialDelay: this.initialDelay,
      ...(signal !== undefined && { signal }),
      isRetryable: (error) => error instanceof JevError && RETRYABLE_STATUS.has(error.status),
    });

    const answers = payload.answers ?? {};
    const mapped: Record<string, Decision<unknown>> = {};
    for (const name of Object.keys(questions)) {
      mapped[name] = toDecision(name, answers[name]);
    }

    // The mapped shape is guaranteed by toDecision, but only the question type
    // knows which variant each entry is — hence the assertion at the boundary.
    return mapped as Answers<Q>;
  }

  private async post(
    body: string,
    signal?: AbortSignal,
  ): Promise<{ answers?: Record<string, unknown> }> {
    const timeoutSignal = AbortSignal.timeout(this.timeout);
    const requestSignal =
      signal !== undefined ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    const response = await this.fetchImpl(
      new Request(this.endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json',
        },
        body,
        signal: requestSignal,
      }),
    );

    if (!response.ok) {
      throw new JevError(`Jev request failed with status ${response.status}`, response.status);
    }

    return (await response.json()) as { answers?: Record<string, unknown> };
  }
}
