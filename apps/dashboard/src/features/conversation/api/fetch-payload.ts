import { telemetryHref } from '@/features/telemetry/telemetry-href';
import { httpGet } from '@/lib/http/client';

interface PayloadResponse {
  data: { chunk: string; totalBytes: number; truncated: boolean };
}

export async function fetchPayload(id: string, botId = ''): Promise<string> {
  const response = await httpGet<PayloadResponse>(
    telemetryHref(`/api/payloads/${encodeURIComponent(id)}`, botId),
  );
  return response.data.chunk;
}
