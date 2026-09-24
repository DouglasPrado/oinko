import Link from 'next/link';
import { Bot, FolderGit2, ListChecks, Plug } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const links = [
  { href: '/bots', label: 'Bots', icon: Bot },
  { href: '/trabalhos', label: 'Trabalhos', icon: ListChecks },
  { href: '/projetos', label: 'Projetos', icon: FolderGit2 },
  { href: '/integracoes', label: 'Integrações', icon: Plug },
];

export function currentSection(pathname: string) {
  const sectionPath =
    pathname === '/' || pathname === '/telemetria' || pathname.startsWith('/threads/')
      ? '/bots'
      : /^\/bots\/[^/]+\/trabalhos/.test(pathname)
        ? '/trabalhos'
        : pathname;
  return links.find(({ href }) => sectionPath === href || sectionPath.startsWith(`${href}/`));
}

/** Item de navegacao lateral: selecao por superficie cinza e contraste, nunca por cor de marca. */
const navItemStyle =
  'flex h-11 w-full items-center gap-2 rounded-md px-2.5 text-sm transition-colors lg:h-9 [&_svg]:size-4 [&_svg]:shrink-0';

export function ProductNav({ pathname }: { pathname: string }) {
  const active = currentSection(pathname)?.href;
  return (
    <nav aria-label="Principal" className="space-y-0.5 px-2 py-2">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={active === href ? 'page' : undefined}
          className={cn(
            navItemStyle,
            active === href
              ? 'bg-selected font-medium text-ink'
              : 'text-ink-muted hover:bg-hover hover:text-ink',
          )}
        >
          <Icon aria-hidden className={active === href ? 'text-brand-ink' : undefined} />
          {label}
        </Link>
      ))}
    </nav>
  );
}
