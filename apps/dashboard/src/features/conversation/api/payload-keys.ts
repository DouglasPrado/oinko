export const payloadKeys = {
  all: ['payloads'] as const,
  detail: (id: string) => [...payloadKeys.all, id] as const,
};
