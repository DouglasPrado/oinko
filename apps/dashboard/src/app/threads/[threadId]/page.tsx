import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { listExecutions } from '@/server/repositories/execution-repository';
import { EmptyState } from '@/components/shared/empty-state';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  const decoded = decodeURIComponent(threadId);
  const executions = listExecutions(decoded);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <nav className="text-sm text-ink-muted">
        <Link href="/" className="text-time underline-offset-2 hover:underline">
          Conversas
        </Link>
        <span className="px-2">/</span>
        <span className="font-mono">{decoded}</span>
      </nav>

      <h1 className="mt-3 border-b border-rule pb-4 text-xl font-medium">
        Respostas desta conversa
      </h1>

      {executions.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nenhuma resposta registrada"
            description="Esta thread nao tem execucoes gravadas dentro da janela de retencao."
          />
        </div>
      ) : (
        <ol className="mt-6">
          {executions.map((execution) => (
            <li key={execution.traceId} className="border-b border-rule/60">
              <Link
                href={`/threads/${encodeURIComponent(decoded)}/${execution.traceId}`}
                className="flex flex-wrap items-center gap-x-6 gap-y-1 py-3 hover:bg-surface"
              >
                <span className="tabular w-36 text-sm text-ink-muted">
                  {new Date(execution.startedAt).toLocaleString('pt-BR', {
                    dateStyle: 'short',
                    timeStyle: 'medium',
                  })}
                </span>
                <span className="flex-1 text-sm">{execution.model}</span>
                <span className="tabular text-sm text-time">
                  {formatDuration(execution.durationMs)}
                </span>
                <span className="tabular text-sm text-spend">{formatUsd(execution.costUsd)}</span>
                <span className="tabular text-sm text-ink-muted">
                  {formatTokens(execution.totalTokens)} tok
                </span>
                {execution.status === 'error' ? (
                  <span className="text-sm text-fault">erro</span>
                ) : null}
                <ChevronRight className="size-4 text-ink-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
