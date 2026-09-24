'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import type { BotProfile } from '@oinko/bots/schema';
import type { BotStatus } from '@oinko/bots';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

type SidebarBot = BotProfile & { status: BotStatus };

/** Mesma chave do console de bots: salvar ou iniciar la atualiza a barra aqui. */
export const sidebarBotsKey = ['bots'];

export async function fetchSidebarBots(): Promise<SidebarBot[]> {
  const response = await fetch('/api/bots', { cache: 'no-store' });
  if (!response.ok) throw new Error('Bots indisponíveis.');
  return (await response.json()) as SidebarBot[];
}

function useSidebarBots() {
  return useQuery({ queryKey: sidebarBotsKey, queryFn: fetchSidebarBots, refetchInterval: 5000 });
}

const DOT: Record<BotStatus['state'], string> = {
  running: 'bg-ready',
  stopped: 'bg-ink-disabled',
  unavailable: 'bg-error',
};

const STATE: Record<BotStatus['state'], string> = {
  running: 'em execução',
  stopped: 'parado',
  unavailable: 'sem resposta',
};

const LIMIT = 8;

/** Atalho para cada bot, com o estado num ponto: a barra diz o que esta de pe. */
export function SidebarBots({ pathname }: { pathname: string }) {
  const bots = useSidebarBots();
  if (!bots.data?.length) return null;
  const shown = bots.data.slice(0, LIMIT);

  return (
    <nav aria-label="Seus bots" className="px-2 py-2">
      <h2 className="flex h-8 items-center px-2.5 text-xs font-medium text-ink-muted">Seus bots</h2>
      <ul className="space-y-px">
        {shown.map((bot) => {
          const href = `/bots/${bot.id}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={bot.id}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-10 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors lg:h-8',
                  active
                    ? 'bg-selected font-medium text-ink'
                    : 'text-ink-muted hover:bg-hover hover:text-ink',
                )}
              >
                <span
                  aria-hidden
                  className={cn('size-2 shrink-0 rounded-full', DOT[bot.status.state])}
                />
                <span className="min-w-0 flex-1 truncate">{bot.name}</span>
                <span className="sr-only">, {STATE[bot.status.state]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {bots.data.length > LIMIT && (
        <Link
          href="/bots"
          className="mt-0.5 flex h-8 items-center rounded-md px-2.5 text-[13px] text-ink-muted hover:bg-hover hover:text-ink"
        >
          Ver todos os {bots.data.length}
        </Link>
      )}
    </nav>
  );
}

/**
 * Aviso compacto no rodape da barra quando algum bot nao pode rodar como esta.
 *
 * O ambar sustenta a mensagem sem tomar o painel: contorno e icone, fundo branco.
 */
export function AttentionPanel() {
  const bots = useSidebarBots();
  const pending = (bots.data ?? []).filter((bot) => !bot.hasApiKey || bot.status.needsRestart);
  if (!pending.length) return null;
  const single = pending.length === 1 ? pending[0] : undefined;

  return (
    <div className="mx-2 mb-2 rounded-xl border border-warning/50 bg-canvas p-3">
      <p className="flex items-center gap-2 text-[13px] font-medium text-ink">
        <TriangleAlert className="size-4 shrink-0 text-warning-ink" aria-hidden />
        {single
          ? `${single.name} precisa de atenção`
          : `${pending.length} bots precisam de atenção`}
      </p>
      <p className="mt-1 text-xs leading-[1.45] text-ink-muted">
        {single && !single.hasApiKey
          ? 'Configure a chave da API antes de iniciar.'
          : single
            ? 'Há alterações salvas. Reinicie para aplicá-las.'
            : 'Falta chave da API ou há alterações esperando reinício.'}
      </p>
      <Link
        href={single ? `/bots/${single.id}` : '/bots'}
        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'mt-3 w-full' })}
      >
        {single ? 'Abrir bot' : 'Ver bots'}
      </Link>
    </div>
  );
}
