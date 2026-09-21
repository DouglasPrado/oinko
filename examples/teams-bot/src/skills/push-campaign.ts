import type { AgentSkill } from '@gba/ai-harness';

export const pushCampaignSkill: AgentSkill = {
  name: 'push_campaign',
  description: 'Create and send push notification campaigns',
  instructions: 'Help the user create push notification campaigns.',
  inputSchema: { type: 'object', properties: {} },
};
