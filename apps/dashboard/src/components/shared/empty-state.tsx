import { Inbox } from 'lucide-react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

/** Tela vazia e convite a agir, nao aviso de ausencia. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-rule-strong px-6 py-12 text-center">
      <span className="mb-4 flex size-10 items-center justify-center rounded-xl border border-rule text-ink-muted">
        <Inbox className="size-4" aria-hidden />
      </span>
      <h2 className="text-base font-medium tracking-[-0.1px]">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
