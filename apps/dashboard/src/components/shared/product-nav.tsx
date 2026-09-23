import Link from 'next/link';
import { LogoutButton } from './logout-button';

export function ProductNav({ active }: { active: string }) {
  const links = [
    ['/bots', 'Bots'],
    ['/projetos', 'Projetos'],
    ['/ambientes', 'Ambientes'],
    ['/previas', 'Prévias'],
    ['/', 'Telemetria'],
    ['/integracoes', 'Integrações'],
  ];
  return (
    <nav
      aria-label="Principal"
      className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-ink-muted"
    >
      {links.map(([href, label]) => (
        <Link
          key={href}
          href={href!}
          aria-current={active === href ? 'page' : undefined}
          className={active === href ? 'font-medium text-ink' : 'hover:text-ink'}
        >
          {label}
        </Link>
      ))}
      <span className="ml-auto">
        <LogoutButton />
      </span>
    </nav>
  );
}
