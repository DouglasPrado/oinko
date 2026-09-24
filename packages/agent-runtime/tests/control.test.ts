import { afterEach, expect, it, vi } from 'vitest';
import { serviceSocketPath } from '../src/control.js';

afterEach(() => vi.unstubAllEnvs());
it('shares one control endpoint across clients with different temporary directories', () => {
  vi.stubEnv('TMPDIR', '/tmp/terminal');
  vi.stubEnv('TEMP', '/tmp/terminal');
  vi.stubEnv('TMP', '/tmp/terminal');
  const socket = serviceSocketPath('/project/.harness/bots/dev');
  vi.stubEnv('TMPDIR', '/tmp/mcp');
  vi.stubEnv('TEMP', '/tmp/mcp');
  vi.stubEnv('TMP', '/tmp/mcp');
  expect(serviceSocketPath('/project/.harness/bots/dev')).toBe(socket);
  expect(serviceSocketPath('/project/.harness/bots/other')).not.toBe(socket);
});
