import { Workbench } from '@/components/shell/workbench';
import { BotConsole } from '@/features/bots/bot-console';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function BotsPage() {
  return (
    <Workbench>
      <div className="mx-auto max-w-7xl px-5 py-6 md:px-10">
        <BotConsole />
      </div>
    </Workbench>
  );
}
