'use client';

import { useCallback, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, Search, X } from 'lucide-react';
import { ProductNav, currentSection } from '@/components/shared/product-nav';
import { LogoutButton } from '@/components/shared/logout-button';
import { Brand } from '@/components/shared/brand';
import { cn } from '@/lib/utils/cn';
import { CommandMenu, useCommandShortcut } from './command-menu';
import { AttentionPanel, SidebarBots } from './sidebar-bots';

interface Props {
  children: React.ReactNode;
  conversations?: React.ReactNode;
  inspector?: React.ReactNode;
}

/**
 * Barra lateral persistente e clara no desktop; gaveta sob o cabecalho no celular.
 *
 * A gaveta cobre a pagina em vez de empurra-la: abrir o menu nao pode fazer o
 * conteudo pular, e fechar devolve o foco ao botao que abriu.
 */
export function DashboardShell({ children, conversations, inspector }: Props) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const open = openPath === pathname;
  const trigger = useRef<HTMLButtonElement>(null);
  const openSearch = useCallback(() => setSearching(true), []);
  useCommandShortcut(openSearch);

  return (
    <div
      className="flex min-h-dvh min-w-0 flex-col lg:flex-row"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          setOpenPath(null);
          trigger.current?.focus();
        }
      }}
    >
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-rule bg-canvas px-4 lg:hidden">
        <Brand />
        <span aria-hidden className="text-rule-strong">
          /
        </span>
        <span className="min-w-0 truncate text-sm text-ink-muted">
          {currentSection(pathname)?.label}
        </span>
        <button
          ref={trigger}
          type="button"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          aria-controls="dashboard-navigation"
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-rule-strong bg-canvas px-3 text-sm font-medium text-ink transition-colors hover:bg-hover"
          onClick={() => setOpenPath(open ? null : pathname)}
        >
          {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          Menu
        </button>
      </header>
      <aside
        id="dashboard-navigation"
        aria-label="Navegação da dashboard"
        className={cn(
          'flex-col bg-paper',
          'lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:flex lg:h-dvh lg:w-62 lg:shrink-0 lg:self-start lg:border-r lg:border-rule',
          open ? 'fixed inset-x-0 top-14 bottom-0 z-40 flex' : 'hidden',
        )}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a')) setOpenPath(null);
        }}
      >
        <div className="hidden h-16 shrink-0 items-center px-4 lg:flex">
          <Brand className="-mx-1 px-1 py-1" />
        </div>

        <div className="shrink-0 px-2 pt-2 lg:pt-0">
          <button
            type="button"
            aria-keyshortcuts="Meta+K Control+K"
            onClick={openSearch}
            className="flex h-9 w-full items-center gap-2 rounded-md border border-rule-strong bg-canvas px-2.5 text-sm text-ink-subtle transition-colors hover:border-ink-disabled hover:text-ink-muted"
          >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left">Buscar…</span>
            <kbd
              aria-hidden
              className="rounded-sm border border-rule bg-paper px-1.5 text-[11px] leading-5 text-ink-muted"
            >
              ⌘K
            </kbd>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ProductNav pathname={pathname} />
          <div className="border-t border-rule">
            <SidebarBots pathname={pathname} />
          </div>
          {conversations ? <div className="border-t border-rule pt-2">{conversations}</div> : null}
        </div>

        <div className="shrink-0 pt-2">
          <AttentionPanel />
          <div className="flex items-center gap-2.5 border-t border-rule px-3 py-2.5">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full border border-rule-strong bg-canvas text-xs font-semibold text-ink"
            >
              A
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-medium text-ink">Administrador</p>
              <p className="truncate text-xs text-ink-muted">Sessão protegida por senha</p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1">{children}</main>
        {inspector}
      </div>
      <CommandMenu open={searching} onOpenChange={setSearching} />
    </div>
  );
}
