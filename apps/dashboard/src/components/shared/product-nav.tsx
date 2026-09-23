import Link from 'next/link';
import { Bot, FolderGit2, Plug } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const links = [
  { href: '/bots', label: 'Bots', icon: Bot },
  { href: '/projetos', label: 'Projetos', icon: FolderGit2 },
  { href: '/integracoes', label: 'Integrações', icon: Plug },
];

export function currentSection(pathname: string) {
  const sectionPath =
    pathname === '/' || pathname === '/telemetria' || pathname.startsWith('/threads/')
      ? '/bots'
      : pathname;
  return links.find(({ href }) => sectionPath === href || sectionPath.startsWith(`${href}/`));
}

export function ProductNav({ pathname }: { pathname: string }) {
  const active = currentSection(pathname)?.href;
  return (
    <nav aria-label="Principal" className="space-y-1 p-3 text-sm">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active === href ? 'page' : undefined}
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-lg border-l-2 px-3 py-2.5',
            active === href
              ? 'border-primary bg-accent font-medium text-ink'
              : 'border-transparent text-ink-muted hover:bg-paper hover:text-ink',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );
}
