import { QueryClient } from '@tanstack/react-query';

/**
 * Telemetria e historica e imutavel, entao os defaults sao o oposto dos de um
 * app transacional: nada refaz a busca ao voltar o foco, e o que ja foi lido
 * fica.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}
