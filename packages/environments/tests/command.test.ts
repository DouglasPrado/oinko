import { expect, it } from 'vitest';
import { runCommand } from '../src/runtime/command.js';

it('preserves UTF-8 characters split across stdout and stderr chunks', async () => {
  const result = await runCommand(process.execPath, [
    '-e',
    `process.stdout.write(Buffer.from([0xf0,0x9f]));process.stderr.write(Buffer.from([0xc3]));setTimeout(()=>{process.stdout.write(Buffer.from([0x90,0xb7]));process.stderr.write(Buffer.from([0xa1]));},50);`,
  ]);
  expect(result).toEqual({ stdout: '🐷', stderr: 'á', exitCode: 0 });
});

it('does not inherit arbitrary host credentials or execute arguments through a shell', async () => {
  process.env.OINKO_TEST_PRIVATE_VALUE = 'must-not-inherit';
  try {
    const result = await runCommand(process.execPath, [
      '-e',
      'console.log(process.env.OINKO_TEST_PRIVATE_VALUE ?? "absent"); console.log(process.argv[1])',
      '$(echo unwanted)',
    ]);
    expect(result.stdout).toBe('absent\n$(echo unwanted)\n');
  } finally {
    delete process.env.OINKO_TEST_PRIVATE_VALUE;
  }
});
it('terminates commands at the deadline and reports failure', async () => {
  await expect(
    runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 }),
  ).rejects.toThrow(/limite/);
});
it('reports an unavailable executable without a hanging operation', async () => {
  await expect(runCommand('/oinko-fixture/missing-docker', ['info'])).rejects.toThrow(
    /Não foi possível executar/,
  );
});
