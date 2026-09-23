import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startEnvironmentService } from '@oinko/environments';

const root = resolve(
  process.env.OINKO_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '../../..'),
);
try {
  const service = await startEnvironmentService(root);
  process.send?.({ ready: true });
  if (process.connected) process.disconnect?.();
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void service.close().then(() => process.exit(0));
  };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
} catch (error) {
  mkdirSync(join(root, '.harness/runtime'), { recursive: true, mode: 0o700 });
  writeFileSync(
    join(root, '.harness/runtime/runner-error.log'),
    error instanceof Error ? error.message : 'Falha ao iniciar',
    { mode: 0o600 },
  );
  process.send?.({ error: 'Gerenciador não iniciou.' });
  process.exitCode = 1;
  if (process.connected) process.disconnect?.();
}
