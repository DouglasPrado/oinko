import { LogoutButton } from '@/components/shared/logout-button';
import Link from 'next/link';
import { BotConsole } from '@/features/bots/bot-console';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function BotsPage() {
  return (
    <main className="mx-auto min-h-dvh max-w-7xl px-5 py-6 md:px-10">
      <nav aria-label="Principal" className="mb-8 flex gap-5 text-sm text-ink-muted">
        <Link href="/bots" aria-current="page" className="font-medium text-ink">
          Bots
        </Link>
        <Link href="/">Telemetria</Link>
        <Link href="/integracoes">Integrações</Link>
        <span className="ml-auto">
          <LogoutButton />
        </span>
      </nav>
      <BotConsole />
    </main>
  );
}
