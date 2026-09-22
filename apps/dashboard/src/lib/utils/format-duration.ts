import { UNKNOWN } from './format-usd';

/** Duracao legivel de relance: ms abaixo de um segundo, minutos acima de um. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return UNKNOWN;
  if (ms < 1_000) return `${Math.round(ms)} ms`;

  const seconds = ms / 1_000;
  if (seconds < 60) return `${seconds.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`;

  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes} min ${rest} s`;
}

/** Deslocamento relativo ao inicio da execucao, como numa fita. */
export function formatOffset(ms: number): string {
  if (ms < 1_000) return `+${Math.round(ms)}ms`;
  return `+${(ms / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}s`;
}
