'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { ProductNav, currentSection } from '@/components/shared/product-nav';
import { LogoutButton } from '@/components/shared/logout-button';
import { cn } from '@/lib/utils/cn';

interface Props {
  children: React.ReactNode;
  conversations?: React.ReactNode;
  inspector?: React.ReactNode;
}

/** Shared sidebar, with an inline disclosure on narrow screens. */
export function DashboardShell({ children, conversations, inspector }: Props) {
  const pathname = usePathname();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const open = openPath === pathname;
  const trigger = useRef<HTMLButtonElement>(null);

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
      <header className="flex min-h-14 items-center gap-3 border-b border-rule bg-surface px-4 lg:hidden">
        <Link href="/bots" className="text-sm font-semibold tracking-wide">
          Oinko
        </Link>
        <span className="truncate text-sm text-ink-muted">{currentSection(pathname)?.label}</span>
        <button
          ref={trigger}
          type="button"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'}
          aria-expanded={open}
          aria-controls="dashboard-navigation"
          className="ml-auto flex min-h-11 items-center gap-2 px-2 text-sm"
          onClick={() => setOpenPath(open ? null : pathname)}
        >
          {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
          Menu
        </button>
      </header>
      <aside
        id="dashboard-navigation"
        aria-label="Navegação da dashboard"
        className={cn(
          'w-full shrink-0 flex-col border-b border-rule bg-surface lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-72 lg:self-start lg:border-r lg:border-b-0',
          open ? 'flex max-h-[calc(100dvh-3.5rem)] lg:max-h-none' : 'hidden',
        )}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a')) setOpenPath(null);
        }}
      >
        <div className="hidden h-16 shrink-0 items-center border-b border-rule px-6 lg:flex">
          <Link href="/bots" className="text-base font-semibold tracking-wide">
            Oinko
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProductNav pathname={pathname} />
          {conversations ? <div className="border-t border-rule">{conversations}</div> : null}
        </div>
        <div className="shrink-0 border-t border-rule px-6 py-4">
          <LogoutButton />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <main className="min-w-0 flex-1">{children}</main>
        {inspector}
      </div>
    </div>
  );
}
