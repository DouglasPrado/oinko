import type { AgentSkill } from '@oinko/core';

export const onboardingSkill: AgentSkill = {
  name: 'onboarding',
  description: 'Guide new users through onboarding',
  instructions: 'Help the user with the onboarding process.',
  inputSchema: { type: 'object', properties: {} },
};
