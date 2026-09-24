import { Workbench } from '@/components/shell/workbench';
import { PageBody, PageHeader } from '@/components/shared/page-header';
import { RunList } from '@/features/programming/run-list';
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
              { label: 'Trabalhos' },
            ]}
            title="Trabalhos"
          />
          <RunList botId={botId} />
        </div>
      </PageBody>
    </Workbench>
  );
}
