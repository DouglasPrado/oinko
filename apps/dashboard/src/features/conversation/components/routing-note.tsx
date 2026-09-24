import { GitBranch } from 'lucide-react';
import type { TimelineItem } from '../schemas/timeline.schema';

interface Answer {
  value?: unknown;
  confidence?: unknown;
}

function routingDecision(items: TimelineItem[]): Answer | null {
  const decision = items.find((item) => item.kind === 'decision' && item.point === 'model_routing');
  if (decision?.kind !== 'decision') return null;

  const tier = decision.answers.tier;
  return typeof tier === 'object' && tier !== null ? tier : null;
}

/**
 * Por que o turno rodou no modelo em que rodou.
 *
 * O roteador so desce para o modelo barato quando tem certeza: decidir "fast"
 * com confianca abaixo do minimo mantem o modelo capaz. Sem esta linha, a tela
 * mostrava "decisao: fast" ao lado de um turno rodado no modelo caro e parecia
 * contradicao — e a explicacao de por que a conta nao baixou ficava invisivel.
 */
export function RoutingNote({
  model,
  requestedModel,
  items,
}: {
  model: string;
  requestedModel: string | null;
  items: TimelineItem[];
}) {
  const tier = routingDecision(items);
  if (!tier) return null;

  const chose = typeof tier.value === 'string' ? tier.value : String(tier.value);
  const confidence =
    typeof tier.confidence === 'number' ? `${Math.round(tier.confidence * 100)}%` : null;
  const switched = requestedModel !== null && requestedModel !== model;

  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-ink-muted">
      <GitBranch className="size-3.5 self-center text-ink-muted" aria-hidden />
      <span>
        Roteamento decidiu <span className="font-medium text-ink">{chose}</span>
        {confidence ? <span className="tabular text-ink"> {confidence}</span> : null}
      </span>
      {switched ? (
        <span>
          · trocou de <span className="font-mono">{requestedModel}</span> para{' '}
          <span className="font-mono">{model}</span>
        </span>
      ) : (
        <span>
          · manteve <span className="font-mono">{model}</span>
          {chose === 'fast' ? ', porque a confianca ficou abaixo do minimo configurado' : ''}
        </span>
      )}
    </p>
  );
}
