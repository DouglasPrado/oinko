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

/** Conversas do bot com leitura tabular e rolagem horizontal em telas estreitas. */
export function ThreadTable({ threads, botId = '' }: { threads: ThreadSummary[]; botId?: string }) {
  return (
    <div className="mx-5 my-5 overflow-hidden rounded-xl border border-rule bg-card">
      <Table className="w-full min-w-[42rem] border-collapse text-sm">
        <TableHeader>
          <TableRow className="border-b border-rule text-left text-[0.8125rem] text-ink-muted">
            <TableHead
              scope="col"
              className="py-2 pr-4 pl-5 font-normal first:pl-5 [&:not(:first-child)]:pl-0"
            >
              Conversa
            </TableHead>
            <TableHead scope="col" className="py-2 pr-4 font-normal">
              Último modelo
            </TableHead>
            <TableHead scope="col" className="py-2 pr-4 text-right font-normal">
              Respostas
            </TableHead>
            <TableHead scope="col" className="py-2 pr-4 text-right font-normal">
              Tokens
            </TableHead>
            <TableHead scope="col" className="py-2 pr-4 text-right font-normal">
              Custo
            </TableHead>
            <TableHead scope="col" className="py-2 pr-4 text-right font-normal">
              Tempo
            </TableHead>
            <TableHead scope="col" className="py-2 text-right font-normal">
              Última atividade
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {threads.map((thread) => (
            <TableRow
              key={threadLabel(thread.threadId)}
              className="border-b border-rule/60 hover:bg-surface"
            >
              <TableCell className="py-4 pr-4 pl-5">
                <Link
                  href={telemetryHref(`/threads/${encodeURIComponent(thread.threadId)}`, botId)}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {threadLabel(thread.threadId)}
                </Link>
                {thread.errorCount > 0 ? (
                  <Badge variant="destructive" className="ml-2">
                    {thread.errorCount} com erro
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="py-4 pr-4 text-ink-muted">
                {thread.lastModel}
                {thread.modelCount > 1 ? (
                  <span className="ml-1.5 text-xs" title="a conversa usou mais de um modelo">
                    +{thread.modelCount - 1}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tabular py-4 pr-4 text-right">
                {thread.executionCount}
              </TableCell>
              <TableCell className="tabular py-4 pr-4 text-right">
                {formatTokens(thread.totalTokens)}
              </TableCell>
              <TableCell className="tabular py-4 pr-4 text-right text-spend">
                {formatUsd(thread.costUsd)}
                {thread.unknownCostCount > 0 ? (
                  <span className="ml-1 text-xs text-ink-muted">
                    +{thread.unknownCostCount} sem custo
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tabular py-4 pr-4 text-right text-time">
                {formatDuration(thread.totalDurationMs)}
              </TableCell>
              <TableCell className="tabular py-4 pr-5 text-right text-ink-muted">
                {when(thread.lastStartedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
