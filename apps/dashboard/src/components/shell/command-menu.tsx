'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, CornerDownLeft, FolderGit2, Plug, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import { sidebarBotsKey, fetchSidebarBots } from './sidebar-bots';

interface Entry {
  id: string;
  label: string;
  hint: string;
  href: string;
  icon: typeof Bot;
}

const SECTIONS: Entry[] = [
  { id: 'nav-bots', label: 'Bots', hint: 'Seção', href: '/bots', icon: Bot },
  { id: 'nav-projetos', label: 'Projetos', hint: 'Seção', href: '/projetos', icon: FolderGit2 },
  { id: 'nav-integracoes', label: 'Integrações', hint: 'Seção', href: '/integracoes', icon: Plug },
];

async function fetchProjects(): Promise<{ id: string; name: string }[]> {
  const response = await fetch('/api/workspaces', { cache: 'no-store' });
  if (!response.ok) throw new Error('Projetos indisponíveis.');
  const state = (await response.json()) as { projects: { id: string; name: string }[] };
  return state.projects;
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Atalho global para abrir a busca: ⌘K no Mac, Ctrl+K nos demais. */
export function useCommandShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onOpen]);
}

/**
 * Ir para qualquer bot, telemetria ou projeto sem passar pelas listas.
 *
 * Projetos so sao buscados com a busca aberta: ler o estado dos ambientes
 * acorda o gerenciador, e isso nao deve acontecer a cada pagina.
 */
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const bots = useQuery({ queryKey: sidebarBotsKey, queryFn: fetchSidebarBots, enabled: open });
  const projects = useQuery({
    queryKey: ['command-projects'],
    queryFn: fetchProjects,
    enabled: open,
    staleTime: 10_000,
  });

  const entries = useMemo(() => {
    const all: Entry[] = [
      ...SECTIONS,
      ...(bots.data ?? []).flatMap((bot) => [
        { id: `bot-${bot.id}`, label: bot.name, hint: 'Bot', href: `/bots/${bot.id}`, icon: Bot },
        {
          id: `tel-${bot.id}`,
          label: `Telemetria de ${bot.name}`,
          hint: 'Telemetria',
          href: `/bots/${bot.id}/telemetria`,
          icon: Activity,
        },
      ]),
      ...(projects.data ?? []).map((project) => ({
        id: `project-${project.id}`,
        label: project.name,
        hint: 'Projeto',
        href: `/projetos/${project.id}`,
        icon: FolderGit2,
      })),
    ];
    const term = normalize(query.trim());
    return term ? all.filter((entry) => normalize(entry.label).includes(term)) : all;
  }, [bots.data, projects.data, query]);

  const current = Math.min(active, Math.max(entries.length - 1, 0));

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  function go(entry: Entry | undefined): void {
    if (!entry) return;
    onOpenChange(false);
    router.push(entry.href);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setQuery('');
          setActive(0);
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">Buscar na dashboard</DialogTitle>
        <DialogDescription className="sr-only">
          Digite para encontrar bots, telemetria e projetos. Use as setas e Enter para abrir.
        </DialogDescription>
        <div className="flex h-12 items-center gap-2.5 border-b border-rule px-4">
          <Search className="size-4 shrink-0 text-ink-subtle" aria-hidden />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={entries[current] ? `command-${entries[current].id}` : undefined}
            aria-label="Buscar bots, telemetria e projetos"
            placeholder="Buscar bots, telemetria e projetos…"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((index) => Math.min(index + 1, entries.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                go(entries[current]);
              }
            }}
          />
          <kbd className="rounded-sm border border-rule bg-paper px-1.5 py-0.5 text-[11px] text-ink-muted">
            Esc
          </kbd>
        </div>
        <ul
          ref={list}
          id="command-results"
          role="listbox"
          aria-label="Resultados"
          className="max-h-80 overflow-y-auto p-1.5"
        >
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            return (
              <li
                key={entry.id}
                id={`command-${entry.id}`}
                role="option"
                aria-selected={index === current}
                data-index={index}
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm',
                  index === current ? 'bg-hover text-ink' : 'text-ink-muted',
                )}
                onMouseMove={() => setActive(index)}
                onClick={() => go(entry)}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink">{entry.label}</span>
                <span className="shrink-0 text-xs text-ink-muted">{entry.hint}</span>
                {index === current && (
                  <CornerDownLeft className="size-3.5 shrink-0 text-ink-subtle" aria-hidden />
                )}
              </li>
            );
          })}
          {entries.length === 0 && (
            <li className="px-3 py-8 text-center text-[13px] text-ink-muted">
              Nada encontrado para “{query}”.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
