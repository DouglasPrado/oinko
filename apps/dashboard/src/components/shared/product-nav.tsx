import Link from 'next/link';
import { Activity, Bot, Boxes, FolderGit2, MonitorPlay, Plug } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const links = [
  { href: '/bots', label: 'Bots', icon: Bot },
  { href: '/projetos', label: 'Projetos', icon: FolderGit2 },
  { href: '/ambientes', label: 'Ambientes', icon: Boxes },
  { href: '/previas', label: 'Prévias', icon: MonitorPlay },
  { href: '/', label: 'Telemetria', icon: Activity },
  { href: '/integracoes', label: 'Integrações', icon: Plug },
];

export function currentSection(pathname: string) {
  return links.find(({ href }) =>
    href === '/'
      ? pathname === '/' || pathname.startsWith('/threads/')
      : pathname === href || pathname.startsWith(`${href}/`),
  );
}

export function ProductNav({
  pathname,
  telemetryHref = '/',
}: {
  pathname: string;
  telemetryHref?: string;
}) {
  const active = currentSection(pathname)?.href;
  return (
    <nav aria-label="Principal" className="space-y-1 p-3 text-sm">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href === '/' ? telemetryHref : href}
          aria-current={active === href ? 'page' : undefined}
          className={cn(
            'flex min-h-11 items-center gap-3 rounded-control border-l-2 px-3 py-2.5',
            active === href
              ? 'border-time bg-paper font-medium text-ink'
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
