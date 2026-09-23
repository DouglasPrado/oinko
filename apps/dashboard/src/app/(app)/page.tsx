import { redirect } from 'next/navigation';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { bot } = await searchParams;
  redirect(
    typeof bot === 'string' && bot ? `/bots/${encodeURIComponent(bot)}/telemetria` : '/bots',
  );
}
