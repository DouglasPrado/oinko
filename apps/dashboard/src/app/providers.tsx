'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { makeQueryClient } from '@/lib/query/query-client';

export function Providers({ children }: { children: React.ReactNode }) {
  // Um cliente por montagem do app, criado no estado para nao ser recriado a
  // cada render nem compartilhado entre requisicoes no servidor.
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
