import { open } from 'node:fs/promises';

/** Check and read the same descriptor, with a hard byte limit even if it grows. */
export async function readTextFile(path: string, maxBytes: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Not a regular file');
    if (info.size > maxBytes) throw new Error(`File too large (${info.size} bytes).`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await file.read(buffer, total, buffer.length - total, null);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > maxBytes) throw new Error(`File too large (more than ${maxBytes} bytes).`);
    return buffer.toString('utf8', 0, total);
  } finally {
    await file.close();
  }
}
