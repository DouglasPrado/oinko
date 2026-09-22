import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const root = process.env.OINKO_ROOT || resolve(process.cwd(), '../..');
if (!existsSync(resolve(root, '.harness/dashboard-auth.json'))) {
  console.error(
    'Inicie a dashboard localmente e configure a senha em /login antes de habilitar acesso pela rede.',
  );
  process.exitCode = 1;
} else {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'next',
      process.argv[2] === 'dev' ? 'dev' : 'start',
      '-H',
      '0.0.0.0',
      '-p',
      process.env.PORT || '3111',
    ],
    { stdio: 'inherit' },
  );
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', (code) => {
    process.exitCode = code || 0;
  });
}
