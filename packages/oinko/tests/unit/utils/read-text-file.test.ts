import { mkdtemp, open, writeFile, rename, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { readTextFile } from '../../../src/utils/read-text-file.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'oinko-bounded-read-'));
  directories.push(directory);
  const path = join(directory, 'file.txt');
  await writeFile(path, 'original');
  return path;
}

it('reads UTF-8 and enforces the limit in bytes', async () => {
  const path = await fixture();
  await writeFile(path, 'ação');
  expect(await readTextFile(path, 6)).toBe('ação');
  await expect(readTextFile(path, 5)).rejects.toThrow(/too large/);
});

it('rejects a file that grows after its size was checked', async () => {
  const path = await fixture();
  const handle = await open(path, 'r');
  const prototype = Object.getPrototypeOf(handle) as typeof handle;
  const stat = prototype.stat;
  await handle.close();
  vi.spyOn(prototype, 'stat').mockImplementationOnce(async function (this: typeof handle) {
    const result = await stat.call(this);
    await appendFile(path, ' more bytes');
    return result;
  });
  await expect(readTextFile(path, 10)).rejects.toThrow(/too large/);
});

it('reads the opened file even if its pathname is replaced', async () => {
  const path = await fixture();
  const handle = await open(path, 'r');
  const prototype = Object.getPrototypeOf(handle) as typeof handle;
  const stat = prototype.stat;
  await handle.close();
  vi.spyOn(prototype, 'stat').mockImplementationOnce(async function (this: typeof handle) {
    const result = await stat.call(this);
    await rename(path, path + '.old');
    await writeFile(path, 'replacement');
    return result;
  });
  expect(await readTextFile(path, 20)).toBe('original');
});
