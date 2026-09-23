import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../../tests/helpers/render';
import userEvent from '@testing-library/user-event';
import { PayloadViewer } from './payload-viewer';

const BIG = { id: 'abc', sizeBytes: 184_320, preview: 'inicio do prompt', redacted: true };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PayloadViewer', () => {
  it('shows the preview and the size without fetching anything', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<PayloadViewer label="Entrada" payload={BIG} />);

    expect(screen.getByText(/inicio do prompt/)).toBeInTheDocument();
    expect(screen.getByText('180 KB')).toBeInTheDocument();
    // 180 KB por chamada derrubaria a pagina se viessem juntos.
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it('fetches the body only when asked', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { chunk: 'corpo inteiro' } }), { status: 200 }),
    );

    render(<PayloadViewer label="Entrada" payload={BIG} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver completo' }));

    expect(await screen.findByText('corpo inteiro')).toBeInTheDocument();
  });

  it('reports a failure in the interface voice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'PAYLOAD_NOT_FOUND', message: 'Esse conteudo nao esta mais no banco' },
        }),
        {
          status: 404,
        },
      ),
    );

    render(<PayloadViewer label="Entrada" payload={BIG} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver completo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('nao esta mais no banco');
  });

  it('offers nothing to expand when the preview already covers the content', () => {
    render(
      <PayloadViewer
        label="Entrada"
        payload={{ id: 'x', sizeBytes: 5, preview: 'curto', redacted: true }}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Ver completo' })).not.toBeInTheDocument();
  });

  it('renders nothing for an empty payload instead of an empty box', () => {
    const { container } = render(
      <PayloadViewer
        label="Saida"
        payload={{ id: 'y', sizeBytes: 0, preview: '', redacted: true }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('warns when the stored content was never redacted', () => {
    render(<PayloadViewer label="Entrada" payload={{ ...BIG, redacted: false }} />);
    expect(screen.getByText('conteudo nao redigido')).toBeInTheDocument();
  });
});
