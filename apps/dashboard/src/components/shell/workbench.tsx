import { ThreadRail } from './thread-rail';
import { InspectorPanel } from './inspector-panel';
import { DashboardShell } from './dashboard-shell';

interface Props {
  activeThreadId?: string;
  activeTraceId?: string;
  showConversations?: boolean;
  children: React.ReactNode;
  inspector?: React.ReactNode;
}

/** Navegação comum. Conversas e inspetor pertencem à telemetria. */
export function Workbench({
  activeThreadId,
  activeTraceId,
  showConversations = false,
  children,
  inspector,
}: Props) {
  return (
    <DashboardShell
      conversations={
        showConversations ? (
          <ThreadRail
            {...(activeThreadId !== undefined && { activeThreadId })}
            {...(activeTraceId !== undefined && { activeTraceId })}
          />
        ) : null
      }
      inspector={inspector ? <InspectorPanel>{inspector}</InspectorPanel> : null}
    >
      {children}
    </DashboardShell>
  );
}
