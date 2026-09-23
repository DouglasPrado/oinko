import { Workbench } from '@/components/shell/workbench';
import { WorkspacesConsole } from '@/features/projects/workspaces-console';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function EnvironmentsPage() {
  return (
    <Workbench>
      <div className="mx-auto max-w-7xl px-5 py-6 md:px-10">
        <WorkspacesConsole view="environments" />
      </div>
    </Workbench>
  );
}
