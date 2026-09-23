import { ProductNav } from '@/components/shared/product-nav';
import { BotConsole } from '@/features/bots/bot-console';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function BotsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-7xl px-5 py-6 md:px-10">
      <ProductNav active="/bots" />
      <BotConsole />
    </main>
  );
}
