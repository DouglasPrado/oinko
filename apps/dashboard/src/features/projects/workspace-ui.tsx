import type { ReactNode } from 'react';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { StatusDot, stateTone } from '@/components/shared/status-dot';
import { cn } from '@/lib/utils/cn';
import { stateLabel } from './shared';

export function Status({ state, className }: { state: string; className?: string }) {
  const { tone, pulse } = stateTone(state);
  return (
    <StatusDot
      tone={tone}
      pulse={pulse}
      label={stateLabel[state] ?? state}
      {...(className !== undefined && { className })}
    />
  );
}

/**
 * Faixa de numeros separados por hairline, num unico contorno.
 *
 * Um cartao elevado por metrica disputaria atencao com a lista logo abaixo, que
 * e a protagonista da pagina.
 */
export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-rule bg-rule xl:grid-cols-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Metric({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0 bg-canvas px-4 py-3.5">
      <div className="flex items-center gap-2 text-[13px] text-ink-muted [&_svg]:size-4 [&_svg]:shrink-0">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 truncate text-xl leading-[1.3] font-semibold tracking-[-0.3px] tabular-nums">
        {value}
      </div>
      {hint && <p className="mt-0.5 truncate text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

export function Blank({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Empty className="min-h-56">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}

/** Contorno de lista densa: linhas separadas por hairline, nunca um cartao por registro. */
export const listStyle =
  'divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-canvas';
