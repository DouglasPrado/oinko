interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

/** Tela vazia e convite a agir, nao aviso de ausencia. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="border border-rule bg-surface px-6 py-10">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
