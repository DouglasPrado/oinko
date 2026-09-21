import type { AgentSkill } from '@gba/ai-harness';

export const onboardingSkill: AgentSkill = {
  name: 'onboarding',
  description: 'Guide new users through onboarding',
  instructions: 'Help the user with the onboarding process.',
  inputSchema: { type: 'object', properties: {} },
};
