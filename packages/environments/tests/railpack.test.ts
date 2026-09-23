import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ServiceSchema } from '../src/contracts/index.js';
import { imageBuilders } from '../src/builders/index.js';
import { runCommand } from '../src/runtime/command.js';

it.skipIf(process.env.OINKO_RAILPACK_TEST !== '1')(
  'builds and runs a real Railpack image with public build variables',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-railpack-'));
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({
        name: 'oinko-railpack-fixture',
        version: '1.0.0',
        private: true,
        engines: { node: '22' },
        scripts: { build: 'node build.cjs', start: 'node server.cjs' },
      }),
    );
    writeFileSync(
      join(source, 'build.cjs'),
      "require('node:fs').writeFileSync('built.txt', process.env.PUBLIC_MESSAGE || 'missing')",
    );
    writeFileSync(
      join(source, 'server.cjs'),
      "require('node:http').createServer((req,res)=>res.end(require('node:fs').readFileSync('built.txt'))).listen(3000,'0.0.0.0')",
    );
    const tag = `oinko-railpack-test-${process.pid}:latest`;
    const container = `oinko-railpack-run-${process.pid}`;
    let output = '';
    try {
      await imageBuilders(root).railpack.build({
        service: ServiceSchema.parse({
          id: 'web',
          repositoryId: 'app',
          builder: 'railpack',
          buildEnvironment: { PUBLIC_MESSAGE: 'built-by-railpack' },
        }),
        source,
        tag,
        directory: join(root, 'control'),
        onOutput: (text) => {
          output = (output + text).slice(-8000);
        },
      });
      await runCommand('docker', ['run', '-d', '--name', container, tag]);
      const result = await runCommand('docker', [
        'exec',
        container,
        'node',
        '-e',
        "(async()=>{for(let i=0;i<50;i++){try{const r=await fetch('http://127.0.0.1:3000');process.stdout.write(await r.text());return;}catch(e){if(i===49)throw e;await new Promise(r=>setTimeout(r,100));}}})()",
      ]);
      expect(result.stdout.trim()).toBe('built-by-railpack');
    } catch (error) {
      process.stderr.write(output);
      throw error;
    } finally {
      await runCommand('docker', ['rm', '-f', container], { allowFailure: true });
      await runCommand('docker', ['image', 'rm', tag], { allowFailure: true });
      rmSync(root, { recursive: true, force: true });
    }
  },
  1_000_000,
);
