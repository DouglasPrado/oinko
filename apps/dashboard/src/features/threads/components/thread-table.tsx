import { threadLabel } from '@/features/telemetry/thread-label';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import Link from 'next/link';
import type { ThreadSummary } from '../schemas/thread.schema';
import { formatUsd } from '@/lib/utils/format-usd';
import { formatDuration } from '@/lib/utils/format-duration';
import { formatTokens } from '@/lib/utils/format-tokens';

function when(ms: number): string {
  return new Date(ms).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Conversas do bot com leitura tabular e rolagem horizontal em telas estreitas.
 *
 * A conversa absorve a largura que sobra; numeros ficam em colunas fixas e
 * alinhadas a direita para comparar de relance.
 */
export function ThreadTable({ threads, botId = '' }: { threads: ThreadSummary[]; botId?: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-canvas">
      <Table className="min-w-[44rem]">
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="pl-4">
              Conversa
            </TableHead>
            <TableHead scope="col">Último modelo</TableHead>
            <TableHead scope="col" className="w-24 text-right">
              Respostas
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              Tokens
            </TableHead>
            <TableHead scope="col" className="w-32 text-right">
              Custo
            </TableHead>
            <TableHead scope="col" className="w-24 text-right">
              Tempo
            </TableHead>
            <TableHead scope="col" className="w-40 pr-4 text-right">
              Última atividade
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {threads.map((thread) => (
            <TableRow key={threadLabel(thread.threadId)}>
              <TableCell className="pl-4">
                <div className="flex min-w-0 items-center gap-2">
                  <Link
                    href={telemetryHref(`/threads/${encodeURIComponent(thread.threadId)}`, botId)}
                    className="max-w-80 truncate font-medium text-ink underline-offset-4 hover:underline"
                    title={threadLabel(thread.threadId)}
                  >
                    {threadLabel(thread.threadId)}
                  </Link>
                  {thread.errorCount > 0 ? (
                    <Badge variant="destructive">{thread.errorCount} com erro</Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell className="w-full max-w-0">
                <span className="block truncate font-mono text-[13px] text-ink-muted">
                  {thread.lastModel}
                  {thread.modelCount > 1 ? (
                    <span
                      className="ml-1.5 font-sans text-xs"
                      title="a conversa usou mais de um modelo"
                    >
                      +{thread.modelCount - 1}
                    </span>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="tabular text-right">{thread.executionCount}</TableCell>
              <TableCell className="tabular text-right">
                {formatTokens(thread.totalTokens)}
              </TableCell>
              <TableCell className="tabular text-right">
                {formatUsd(thread.costUsd)}
                {thread.unknownCostCount > 0 ? (
                  <span className="ml-1 text-xs text-ink-muted">
                    +{thread.unknownCostCount} sem custo
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tabular text-right text-ink-muted">
                {formatDuration(thread.totalDurationMs)}
              </TableCell>
              <TableCell className="tabular pr-4 text-right text-ink-muted">
                {when(thread.lastStartedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
