import type { TelemetrySelection } from '@/server/repositories/telemetry-sources';
import { TelemetryProvider } from '@/features/telemetry/telemetry-context';
import { TelemetryBotSelector } from '@/features/telemetry/bot-selector';
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
        telemetryHref={telemetryHref('/', telemetry?.id ?? '')}
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
          <TelemetryBotSelector selected={telemetry.id} options={telemetry.options} />
        ) : null}
        {children}
      </DashboardShell>
    </TelemetryProvider>
  );
}
