import { Workbench } from '@/components/shell/workbench';
import { PageBody, PageHeader } from '@/components/shared/page-header';
import { EvaluationReport } from '@/features/evaluation/evaluation-report';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  return (
    <Workbench>
      <PageBody>
        <div className="space-y-6">
          <PageHeader
            trail={[
              { label: 'Bots', href: '/bots' },
              { label: botId, href: `/bots/${encodeURIComponent(botId)}` },
              { label: 'Avaliações' },
            ]}
            title="Avaliações"
          />
          <EvaluationReport botId={botId} />
        </div>
      </PageBody>
    </Workbench>
  );
}
