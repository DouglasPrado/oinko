import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../../tests/helpers/render';
import { RoutingNote } from './routing-note';
import type { TimelineItem } from '../schemas/timeline.schema';

function decision(value: string, confidence: number): TimelineItem {
  return {
    kind: 'decision',
    id: 'd1',
    point: 'model_routing',
    answers: { tier: { value, confidence } },
    startedAt: 0,
    durationMs: 10,
  };
}

describe('RoutingNote', () => {
  // O roteador so desce de modelo quando tem certeza. Sem esta frase, a tela
  // mostrava "decisao: fast" ao lado de um turno rodado no modelo caro.
  it('explains a decision that was not applied', () => {
    render(
      <RoutingNote model="gpt-5.6" requestedModel="gpt-5.6" items={[decision('fast', 0.62)]} />,
    );

    expect(screen.getByText('fast')).toBeInTheDocument();
    expect(screen.getByText('62%')).toBeInTheDocument();
    expect(screen.getByText(/abaixo do minimo configurado/)).toBeInTheDocument();
  });

  it('reports the swap when the routing did take effect', () => {
    render(
      <RoutingNote model="gpt-4o-mini" requestedModel="gpt-5.6" items={[decision('fast', 0.93)]} />,
    );

    expect(screen.getByText(/trocou de/)).toBeInTheDocument();
    expect(screen.getByText('gpt-5.6')).toBeInTheDocument();
    expect(screen.getByText('gpt-4o-mini')).toBeInTheDocument();
    expect(screen.queryByText(/abaixo do minimo/)).not.toBeInTheDocument();
  });

  it('does not blame confidence when the decision itself was to stay', () => {
    render(
      <RoutingNote model="gpt-5.6" requestedModel="gpt-5.6" items={[decision('capable', 0.91)]} />,
    );

    expect(screen.getByText('capable')).toBeInTheDocument();
    expect(screen.queryByText(/abaixo do minimo/)).not.toBeInTheDocument();
  });

  it('says nothing when the turn had no routing decision', () => {
    const { container } = render(<RoutingNote model="gpt-5.6" requestedModel={null} items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
