import { ThreadRail } from './thread-rail';
import { InspectorPanel } from './inspector-panel';

interface Props {
  activeThreadId?: string;
  activeTraceId?: string;
  children: React.ReactNode;
  /** Painel direito. Ausente, o centro ocupa o espaco. */
  inspector?: React.ReactNode;
}

/**
 * Bancada: conversas a esquerda, o trabalho no centro, o inspetor a direita.
 *
 * No celular as tres viram uma pilha — a barra lateral so aparece na tela
 * inicial, e o inspetor abre sobre o conteudo.
 */
export function Workbench({ activeThreadId, activeTraceId, children, inspector }: Props) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden lg:flex-row">
      <div className="hidden lg:block lg:shrink-0">
        <ThreadRail
          {...(activeThreadId !== undefined && { activeThreadId })}
          {...(activeTraceId !== undefined && { activeTraceId })}
        />
      </div>

      <main className="min-w-0 flex-1">{children}</main>

      {inspector ? <InspectorPanel>{inspector}</InspectorPanel> : null}
    </div>
  );
}
