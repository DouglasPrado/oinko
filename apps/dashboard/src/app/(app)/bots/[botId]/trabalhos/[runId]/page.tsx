import { Workbench } from '@/components/shell/workbench';
import { PageBody } from '@/components/shared/page-header';
import { RunDetailView } from '@/features/programming/run-detail';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ botId: string; runId: string }> }) {
  const { botId, runId } = await params;
  return (
    <Workbench>
      <PageBody>
        <RunDetailView botId={botId} runId={runId} />
      </PageBody>
    </Workbench>
  );
}
