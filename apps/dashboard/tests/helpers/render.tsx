import type { ReactElement } from 'react';
import { render as rtlRender, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Render com os providers do app.
 *
 * Retry desligado: em teste, uma falha esperada nao deve virar espera de
 * backoff — o teste ficaria lento e mascararia o proprio erro que verifica.
 */
export function render(ui: ReactElement): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
