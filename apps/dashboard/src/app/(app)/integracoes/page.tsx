import { Workbench } from '@/components/shell/workbench';
import { PageBody, PageHeader } from '@/components/shared/page-header';
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
      <PageBody>
        <PageHeader title="Integrações">
          <p className="text-sm text-ink-muted">Serviços que o agente usa por MCP.</p>
        </PageHeader>

        <div className="divide-y divide-rule overflow-hidden rounded-xl border border-rule">
          <ConnectionCard status={credentialStatus()} {...(result !== undefined && { result })} />
        </div>
      </PageBody>
    </Workbench>
  );
}
