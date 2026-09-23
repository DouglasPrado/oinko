import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty';
import { stateLabel } from './shared';

export function Trail({ items }: { items: { label: string; href?: string }[] }) {
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
export function Status({ state }: { state: string }) {
  return (
    <Badge
      variant="outline"
      className={
        ['ready', 'running', 'succeeded', 'connected'].includes(state)
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : state === 'failed' || state === 'unavailable'
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'bg-muted text-muted-foreground'
      }
    >
      <span className="size-1.5 rounded-full bg-current" />
      {stateLabel[state] ?? state}
    </Badge>
  );
}
export function Metric({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="gap-0 py-0 shadow-none">
      <CardContent className="p-5">
        <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
          {label}
          {icon}
        </div>
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
export function Blank({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Empty className="min-h-60 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
