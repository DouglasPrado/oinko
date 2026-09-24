import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils/cn';

export interface TrailItem {
  label: string;
  href?: string;
}

/** Escopo da pagina, do mais amplo ao atual, separado por barras. */
export function Trail({ items }: { items: TrailItem[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {item.href ? (
                <BreadcrumbLink asChild>
                  <Link href={item.href}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Contexto, titulo e acoes — nessa ordem, e nada de prosa que a pagina nao pede.
 *
 * O titulo fica no teto da escala do painel (24px): hierarquia aqui vem de
 * posicao e peso, nao de tamanho de vitrine.
 */
export function PageHeader({
  trail,
  title,
  icon,
  badges,
  actions,
  children,
  className,
}: {
  trail?: TrailItem[];
  title: ReactNode;
  icon?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('space-y-3', className)}>
      {trail && <Trail items={trail} />}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-rule bg-canvas text-ink [&_svg]:size-5">
              {icon}
            </span>
          )}
          <h1 className="min-w-0 truncate text-2xl leading-[1.3] font-semibold tracking-[-0.4px]">
            {title}
          </h1>
          {badges && <div className="flex shrink-0 flex-wrap items-center gap-2">{badges}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Cabecalho de uma secao dentro da pagina: titulo, uma linha de apoio e a acao. */
export function SectionHeader({
  title,
  description,
  actions,
  as: Heading = 'h2',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <Heading className="text-base leading-[1.4] font-semibold tracking-[-0.1px]">
          {title}
        </Heading>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Gutter e ritmo vertical comuns a toda pagina da dashboard. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-6 px-4 py-6 md:px-6 lg:py-8', className)}>{children}</div>;
}
