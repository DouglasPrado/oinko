import { ProductNav } from '@/components/shared/product-nav';
import { WorkspacesConsole } from '@/features/projects/workspaces-console';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function EnvironmentsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-7xl px-5 py-6 md:px-10">
      <ProductNav active="/ambientes" />
      <WorkspacesConsole view="environments" />
    </main>
  );
}
