import type { TelemetrySelection } from '@/server/repositories/telemetry-sources';
import { TelemetryProvider } from '@/features/telemetry/telemetry-context';
import Link from 'next/link';
import { Activity, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trail } from '@/features/projects/workspace-ui';
import { telemetryHref } from '@/features/telemetry/telemetry-href';
import { ThreadRail } from './thread-rail';
import { InspectorPanel } from './inspector-panel';
import { DashboardShell } from './dashboard-shell';

interface Props {
  activeThreadId?: string;
  activeTraceId?: string;
  showConversations?: boolean;
  telemetry?: TelemetrySelection;
  children: React.ReactNode;
  inspector?: React.ReactNode;
}

/** Navegação comum. Conversas e inspetor pertencem à telemetria. */
export function Workbench({
  activeThreadId,
  activeTraceId,
  showConversations = false,
  telemetry,
  children,
  inspector,
}: Props) {
  return (
    <TelemetryProvider botId={telemetry?.id ?? ''}>
      <DashboardShell
        conversations={
          showConversations && telemetry ? (
            <ThreadRail
              telemetry={telemetry}
              {...(activeThreadId !== undefined && { activeThreadId })}
              {...(activeTraceId !== undefined && { activeTraceId })}
            />
          ) : null
        }
        inspector={inspector ? <InspectorPanel>{inspector}</InspectorPanel> : null}
      >
        {telemetry ? (
          <div className="space-y-5 border-b bg-card px-5 py-6 md:px-8">
            <Trail
              items={[
                { label: 'Bots', href: '/bots' },
                {
                  label: telemetry.name,
                  ...(telemetry.id ? { href: `/bots/${telemetry.id}` } : {}),
                },
                { label: 'Telemetria' },
              ]}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-semibold">
                  <Activity className="size-5 text-primary" />
                  {telemetry.name}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Telemetria · conversas, respostas e uso do modelo
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Dados deste bot</Badge>
                {telemetry.id && (
                  <Button variant="outline" asChild>
                    <Link href={`/bots/${telemetry.id}`}>
                      <Bot />
                      Voltar ao bot
                    </Link>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href={telemetryHref('/', telemetry.id)}>Visão geral</Link>
                </Button>
              </div>
            </div>
          </div>
        ) : null}
        {children}
      </DashboardShell>
    </TelemetryProvider>
  );
}
