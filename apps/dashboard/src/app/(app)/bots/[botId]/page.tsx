import { Workbench } from '@/components/shell/workbench';
import { BotConsole } from '@/features/bots/bot-console';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ botId: string }> }) {
  return (
    <Workbench>
      <div className="mx-auto max-w-7xl px-5 py-7 md:px-10">
        <BotConsole botId={(await params).botId} />
      </div>
    </Workbench>
  );
}
