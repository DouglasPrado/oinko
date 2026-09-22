import Link from 'next/link';
import type { ThreadSummary } from '../schemas/thread.schema';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';

function when(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Lista densa, alinhada a esquerda, com os numeros a direita em coluna
 * tabular. Separacao por regua de 1px — nao ha cartao nem sombra aqui.
 */
export function ThreadTable({ threads }: { threads: ThreadSummary[] }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule text-left text-[0.8125rem] text-ink-muted">
            <th scope="col" className="py-2 pr-4 font-normal">
              Thread
            </th>
            <th scope="col" className="py-2 pr-4 font-normal">
              Ultimo modelo
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">
              Respostas
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">
              Tokens
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">
              Custo
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-normal">
              Tempo
            </th>
            <th scope="col" className="py-2 text-right font-normal">
              Ultima
            </th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => (
            <tr key={thread.threadId} className="border-b border-rule/60 hover:bg-surface">
              <td className="py-2 pr-4">
                <Link
                  href={`/threads/${encodeURIComponent(thread.threadId)}`}
                  className="font-mono text-time underline-offset-2 hover:underline"
                >
                  {thread.threadId}
                </Link>
                {thread.errorCount > 0 ? (
                  <span className="ml-2 text-xs text-fault">{thread.errorCount} com erro</span>
                ) : null}
              </td>
              <td className="py-2 pr-4 text-ink-muted">
                {thread.lastModel}
                {thread.modelCount > 1 ? (
                  <span className="ml-1.5 text-xs" title="a conversa usou mais de um modelo">
                    +{thread.modelCount - 1}
                  </span>
                ) : null}
              </td>
              <td className="tabular py-2 pr-4 text-right">{thread.executionCount}</td>
              <td className="tabular py-2 pr-4 text-right">{formatTokens(thread.totalTokens)}</td>
              <td className="tabular py-2 pr-4 text-right text-spend">
                {formatUsd(thread.costUsd)}
                {thread.unknownCostCount > 0 ? (
                  <span className="ml-1 text-xs text-ink-muted">
                    +{thread.unknownCostCount} sem custo
                  </span>
                ) : null}
              </td>
              <td className="tabular py-2 pr-4 text-right text-time">
                {formatDuration(thread.totalDurationMs)}
              </td>
              <td className="tabular py-2 text-right text-ink-muted">
                {when(thread.lastStartedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
