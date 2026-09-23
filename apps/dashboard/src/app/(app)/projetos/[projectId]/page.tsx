import { Workbench } from '@/components/shell/workbench';
import { WorkspacesConsole } from '@/features/projects/workspaces-console';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  return (
    <Workbench>
      <div className="mx-auto max-w-7xl px-5 py-7 md:px-10">
        <WorkspacesConsole {...await params} />
      </div>
    </Workbench>
  );
}
