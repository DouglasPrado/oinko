import { Workbench } from '@/components/shell/workbench';
import { credentialStatus } from '@/server/higgsfield/credential-store';
import { ConnectionCard } from '@/features/higgsfield/components/connection-card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const result = typeof params.higgsfield === 'string' ? params.higgsfield : undefined;

  return (
    <Workbench>
      <header className="border-b border-rule px-5 py-4">
        <h1 className="text-base font-medium">Integrações</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-muted">Servicos que o agente usa por MCP.</p>
      </header>

      <ConnectionCard status={credentialStatus()} {...(result !== undefined && { result })} />
    </Workbench>
  );
}
