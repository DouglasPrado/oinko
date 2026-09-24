import { Workbench } from '@/components/shell/workbench';
import { PageBody } from '@/components/shared/page-header';
import { BotConsole } from '@/features/bots/bot-console';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export default function BotsPage() {
  return (
    <Workbench>
      <PageBody>
        <BotConsole />
      </PageBody>
    </Workbench>
  );
}
