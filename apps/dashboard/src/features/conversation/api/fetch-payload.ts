import { httpGet } from '@/lib/http/client';

interface PayloadResponse {
  data: { chunk: string; totalBytes: number; truncated: boolean };
}

export async function fetchPayload(id: string): Promise<string> {
  const response = await httpGet<PayloadResponse>(`/api/payloads/${id}`);
  return response.data.chunk;
}
