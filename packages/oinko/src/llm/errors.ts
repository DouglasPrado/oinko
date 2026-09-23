/** Thrown when the API returns 413 — prompt exceeds context window */
export class PromptTooLongError extends Error {
  constructor(message = 'Prompt too long') {
    super(message);
    this.name = 'PromptTooLongError';
  }
}

/** Thrown when the API returns 529 or 503 — model overloaded */
export class OverloadedError extends Error {
  constructor(message = 'Model overloaded') {
    super(message);
    this.name = 'OverloadedError';
  }
}

/** Thrown when the API returns 402 — insufficient credits/billing */
export class InsufficientCreditsError extends Error {
  constructor(message = 'Insufficient credits') {
    super(message);
    this.name = 'InsufficientCreditsError';
  }
}

/** Classify an API error thrown from fetchAPI */
export function classifyAPIError(error: unknown): unknown {
  if (
    error instanceof PromptTooLongError ||
    error instanceof OverloadedError ||
    error instanceof InsufficientCreditsError
  ) {
    return error;
  }
  if (error instanceof Error) {
    const msg = error.message;
    // Match only the "LLM API error <status>:" prefix produced by fetchAPI,
    // so unrelated digits in request IDs or error strings don't trigger misclassification.
    const match = /LLM API error (\d+):/.exec(msg);
    if (match) {
      const status = Number(match[1]);
      if (status === 402) return new InsufficientCreditsError(msg);
      if (status === 413) return new PromptTooLongError(msg);
      if (status === 529 || (status === 503 && msg.toLowerCase().includes('overload'))) {
        return new OverloadedError(msg);
      }
    }
  }
  return error;
}

/**
 * A geracao existe, mas o custo ainda nao fechou.
 *
 * Distinto de "nao da para saber": este e recuperavel e continua na fila, e e
 * essa diferenca que impede um custo desconhecido de virar zero no relatorio.
 */
export class GenerationNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationNotReadyError';
  }
}
