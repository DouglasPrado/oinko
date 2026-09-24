import { Workbench } from '@/components/shell/workbench';
import { PageBody, PageHeader } from '@/components/shared/page-header';
import { RunList } from '@/features/programming/run-list';
import { RunTree } from '@/features/programming/run-tree';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <Workbench>
      <PageBody>
        <div className="space-y-6">
          <PageHeader title="Trabalhos" />
          <RunTree />
          <RunList />
        </div>
      </PageBody>
    </Workbench>
  );
}
