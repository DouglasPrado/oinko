import 'server-only';
import { resolve } from 'node:path';
import { EnvironmentClient } from '@oinko/environments/client';

export function environmentClient() {
  return new EnvironmentClient(
    process.env.OINKO_ROOT || resolve(process.cwd(), '../..'),
    undefined,
    {
      runnerPath: resolve(process.cwd(), '../environment-runner/dist/main.js'),
    },
  );
}
