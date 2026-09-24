import { Workbench } from '@/components/shell/workbench';
import { PageBody } from '@/components/shared/page-header';
import { WorkspacesConsole } from '@/features/projects/workspaces-console';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <Workbench>
      <PageBody>
        <WorkspacesConsole {...await params} />
      </PageBody>
    </Workbench>
  );
}
