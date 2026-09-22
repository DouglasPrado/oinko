import { cn } from '@/lib/utils/cn';

interface MetricProps {
  label: string;
  value: string;
  /** Grandeza que a cor codifica. */
  tone?: 'time' | 'spend' | 'judge' | 'fault' | 'ok' | 'plain';
  hint?: string;
}

const TONE: Record<NonNullable<MetricProps['tone']>, string> = {
  time: 'text-time',
  spend: 'text-spend',
  judge: 'text-judge',
  fault: 'text-fault',
  ok: 'text-ok',
  plain: 'text-ink',
};

/** Rotulo em sentence case e valor tabular. Sem caixa, sem sombra, sem cartao. */
export function Metric({ label, value, tone = 'plain', hint }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.8125rem] text-ink-muted">{label}</span>
      <span className={cn('tabular text-xl font-medium', TONE[tone])}>{value}</span>
      {hint ? <span className="text-xs text-ink-muted">{hint}</span> : null}
    </div>
  );
}
