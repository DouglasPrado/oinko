# Environment runner

Processo local independente que hospeda `@oinko/environments`. A dashboard e os bots o iniciam sob demanda. Para iniciar manualmente, faça `pnpm build:packages` na raiz e execute `pnpm --filter @oinko/environment-runner start`; `OINKO_ROOT` escolhe a raiz dos dados.

O processo atende um socket Unix privado, controla Docker e persiste operações antes de executá-las. `SIGTERM`/`SIGINT` deixam de aceitar novas operações, aguardam as operações em andamento e fecham os bancos. Os containers e dados permanecem; ao iniciar novamente, o runner reconcilia as prévias existentes.

O cliente aceita `runnerPath` para integrações empacotadas, como Next.js, evitando que o bundler transforme a entrada do processo em um asset. Erros de partida ficam em `.harness/runtime/runner-process.log` e `runner-error.log`.

[Configuração, limites, rede e recuperação](../../packages/environments/README.md).
