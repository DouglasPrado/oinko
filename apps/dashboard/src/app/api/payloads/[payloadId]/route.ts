import { NextResponse } from 'next/server';
import { getPayloadChunk } from '@/server/repositories/payload-repository';

// node:sqlite nao existe no runtime edge.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 262_144;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ payloadId: string }> },
): Promise<NextResponse> {
  const { payloadId } = await params;
  const url = new URL(request.url);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);

  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(limit) || limit <= 0) {
    return NextResponse.json(
      {
        error: { code: 'INVALID_RANGE', message: 'offset e limit precisam ser numeros positivos' },
      },
      { status: 400 },
    );
  }

  const payload = getPayloadChunk(payloadId, offset, limit);
  if (!payload) {
    return NextResponse.json(
      { error: { code: 'PAYLOAD_NOT_FOUND', message: 'Esse conteudo nao esta mais no banco' } },
      { status: 404 },
    );
  }

  if (url.searchParams.get('download') === '1') {
    return new NextResponse(payload.chunk, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${payloadId.slice(0, 12)}.txt"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return NextResponse.json({ data: payload }, { headers: { 'Cache-Control': 'no-store' } });
}
