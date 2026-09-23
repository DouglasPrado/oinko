export const payloadKeys = {
  all: ['payloads'] as const,
  detail: (id: string, botId = '') => [...payloadKeys.all, botId, id] as const,
};
