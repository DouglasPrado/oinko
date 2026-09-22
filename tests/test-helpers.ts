/**
 * Returns an `AsyncIterableIterator` whose `next()` rejects with `err`.
 * Use to mock streaming clients (e.g. `streamChat`) that should fail on first iteration.
 * Equivalent to `async function*() { throw err; }` but without `require-yield` triggering.
 */
export function failingStream<T>(err: Error): AsyncIterableIterator<T> {
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    next: () => Promise.reject(err),
    return: () => Promise.resolve({ value: undefined as never, done: true as const }),
    throw: (e: unknown) => Promise.reject(e instanceof Error ? e : new Error(String(e))),
  };
}

/**
 * Creates a temporary directory and returns its canonical path.
 *
 * On macOS `os.tmpdir()` is `/var/folders/…`, a symlink to `/private/var/…`.
 * Tools under test canonicalise the paths they receive — the path guard has to,
 * or a symlink would be a way around the working-directory check — so a test
 * comparing against the raw `mkdtemp` result fails there while passing on
 * Linux, where `/tmp` is a real directory.
 *
 * Resolving here keeps the test asserting about behaviour rather than about
 * how the host lays out its temp space.
 */
export async function makeTempDir(prefix: string): Promise<string> {
  const { mkdtemp, realpath } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}
