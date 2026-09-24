import { Workbench } from '@/components/shell/workbench';
import { PageBody } from '@/components/shared/page-header';
import { BotConsole } from '@/features/bots/bot-console';
export const dynamic = 'force-dynamic';
export default async function Page({ params }: { params: Promise<{ botId: string }> }) {
  return (
    <Workbench>
      <PageBody>
        <BotConsole botId={(await params).botId} />
      </PageBody>
    </Workbench>
  );
}
