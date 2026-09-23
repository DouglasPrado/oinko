import Page from '@/features/telemetry/execution-page';
export const dynamic = 'force-dynamic';
export default async function ScopedPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string; threadId: string; traceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const p = await params;
  return (
    <Page
      params={Promise.resolve(p)}
      searchParams={Promise.resolve({ ...(await searchParams), bot: p.botId })}
    />
  );
}
