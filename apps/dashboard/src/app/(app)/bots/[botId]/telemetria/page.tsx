import Page from '@/features/telemetry/overview-page';
export const dynamic = 'force-dynamic';
export default async function ScopedPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await params;
  return <Page searchParams={Promise.resolve({ ...(await searchParams), bot: p.botId })} />;
}
