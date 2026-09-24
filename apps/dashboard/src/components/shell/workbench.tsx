import type { TelemetrySelection } from '@/server/repositories/telemetry-sources';
import { TelemetryProvider } from '@/features/telemetry/telemetry-context';
import Link from 'next/link';
import { Activity, Bot, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/shared/page-header';
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
          <PageHeader
            className="border-b border-rule px-4 pt-6 pb-5 md:px-6"
            trail={[
              { label: 'Bots', href: '/bots' },
              {
                label: telemetry.name,
                ...(telemetry.id ? { href: `/bots/${telemetry.id}` } : {}),
              },
              { label: 'Telemetria' },
            ]}
            icon={<Activity aria-hidden />}
            title={telemetry.name}
            badges={
              <Badge variant="secondary" className="max-sm:hidden">
                Dados deste bot
              </Badge>
            }
            actions={
              <>
                {telemetry.id && (
                  <Button variant="outline" asChild>
                    <Link href={`/bots/${telemetry.id}`}>
                      <Bot aria-hidden />
                      Voltar ao bot
                    </Link>
                  </Button>
                )}
                <Button variant="outline" asChild>
                  <Link href={telemetryHref('/', telemetry.id)}>
                    <LayoutGrid aria-hidden />
                    Visão geral
                  </Link>
                </Button>
              </>
            }
          />
        ) : null}
        {children}
      </DashboardShell>
    </TelemetryProvider>
  );
}
