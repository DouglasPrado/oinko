import { Workbench } from '@/components/shell/workbench';
import { PageBody } from '@/components/shared/page-header';
import { WorkspacesConsole } from '@/features/projects/workspaces-console';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function ProjectsPage() {
  return (
    <Workbench>
      <PageBody>
        <WorkspacesConsole />
      </PageBody>
    </Workbench>
  );
}
