import { UNKNOWN } from './format-usd';

export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || Number.isNaN(tokens)) return UNKNOWN;
  if (tokens < 1_000) return String(tokens);
  return `${(tokens / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
}
