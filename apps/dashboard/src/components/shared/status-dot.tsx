import { cn } from '@/lib/utils/cn';

export type StatusTone = 'ready' | 'error' | 'warning' | 'info' | 'neutral';

const DOT: Record<StatusTone, string> = {
  ready: 'bg-ready',
  error: 'bg-error',
  warning: 'bg-warning',
  info: 'bg-info',
  neutral: 'bg-ink-disabled',
};

/**
 * Estado como ponto de 8px mais texto escuro.
 *
 * A linha nunca muda de cor por causa do estado: o ponto carrega a semantica,
 * o texto continua legivel e neutro. `pulse` marca o que ainda esta andando.
 */
export function StatusDot({
  tone,
  label,
  pulse = false,
  className,
}: {
  tone: StatusTone;
  label: React.ReactNode;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-sm text-ink', className)}>
      <span aria-hidden className="relative flex size-2 shrink-0">
        {pulse && (
          <span
            className={cn('absolute inset-0 animate-ping rounded-full opacity-60', DOT[tone])}
          />
        )}
        <span className={cn('relative size-2 rounded-full', DOT[tone])} />
      </span>
      <span>{label}</span>
    </span>
  );
}

/** Mesmo vocabulario de estados para sandbox, tarefa, previa e operacao. */
export function stateTone(state: string): { tone: StatusTone; pulse: boolean } {
  if (['ready', 'running', 'succeeded', 'connected'].includes(state))
    return { tone: 'ready', pulse: false };
  if (['failed', 'unavailable', 'error'].includes(state)) return { tone: 'error', pulse: false };
  if (['building', 'starting', 'creating', 'connecting'].includes(state))
    return { tone: 'warning', pulse: true };
  if (state === 'queued') return { tone: 'neutral', pulse: true };
  return { tone: 'neutral', pulse: false };
}
