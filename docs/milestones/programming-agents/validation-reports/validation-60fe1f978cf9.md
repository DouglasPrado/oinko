# Relatório de validação — 60fe1f978cf9

Gerado por `node scripts/validation-suite.mjs` em 2026-09-24T15:25:52.441Z. Revisão `60fe1f978cf9e71787914238273377a63215d25d` (código sem alterações locais; edições em docs/ não entram no teste). Node v26.8.1.

Um cenário *skipped* ou pendente impede afirmar cobertura dele. Resultados reais (provedor, GitHub, Telegram) e aceite humano nunca são simulados aqui.

## Teste automatizado

| Suíte | Resultado | Aprovados | Falhas | Não executados | Duração |
| --- | --- | ---: | ---: | ---: | ---: |
| pnpm build | ✅ passed | 1 | 0 | 0 | 17s |
| pnpm typecheck | ✅ passed | 1 | 0 | 0 | 10s |
| pnpm lint | ✅ passed | 1 | 0 | 0 | 16s |
| pnpm test | ✅ passed | 1 | 0 | 0 | 31s |
| core (SDK) | ⚠️ partial | 1654 | 0 | 1 | 5s |
| agent-runtime | ✅ passed | 120 | 0 | 0 | 1s |
| workspaces | ✅ passed | 12 | 0 | 0 | 2s |
| environments | ⚠️ partial | 180 | 0 | 71 | 11s |
| bots | ⚠️ partial | 43 | 0 | 4 | 5s |
| mcp-oinko | ⚠️ partial | 19 | 0 | 1 | 2s |
| dashboard (unit) | ✅ passed | 58 | 0 | 0 | 1s |
| gate: sem condicional por ID de piloto | ✅ passed | 1 | 0 | 0 | 0s |
| dashboard E2E (Playwright) | ✅ passed | 39 | 0 | 0 | 77s |

<details><summary>core (SDK): 1 não executado(s)</summary>

- packages/oinko/tests/unit/tools/mcp-adapter.test.ts › MCPAdapter healthCheck race condition (issue #24) concurrent healthCheck fires should not start multiple reconnect attempts

</details>

<details><summary>environments: 71 não executado(s)</summary>

- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) starts the pinned image non-root with the Chromium sandbox, limits and no host access
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) isolates cookies and storage between two bots, two runs and the docs context
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) denies private, metadata, loopback and redirect targets, including subresources
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) lets docs sessions read public documentation while still denying private hosts
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) fills and submits a form, surfaces the intentional error and redacts console and network captures
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) requires a fresh snapshot for stale refs and never acts on old positions
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) uses test credentials only in test sessions of their project and keeps them out of every output
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) captures mobile and full-page screenshots and full content as bounded artifacts
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) reports an interrupted submit as uncertain instead of failed or done
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) ends access of an existing session when the bot is removed from the project
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) reaches only the session project's READY preview through Traefik and binds results to it
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) fails sessions explicitly and cleans up when the browser container crashes, then recovers
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) removes orphan browser containers and fails their sessions when the runner restarts
- packages/environments/tests/browser.e2e.test.ts › managed browser (real Docker + Chromium) expires idle sessions and stops the browser container after the idle period
- packages/environments/tests/docker.test.ts › creates real worktrees and executes code in a project container without changing the source checkout
- packages/environments/tests/docker.test.ts › imports Compose with a completed dependency, updates mounted code and recovers the runner with honest build failures
- packages/environments/tests/docker.test.ts › serves two worktrees through real Compose and Traefik, preserves data, and recovers after manager restart
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose privileged before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose host network before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose host process namespace before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose host IPC before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose host devices before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose capabilities before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose Docker socket before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose absolute host mount before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose parent mount before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose symlink mount before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose external volume before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose volume driver before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose external network before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose include before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose extends before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose host env file before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose implicit host variable before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose unselected secret before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose build context escape before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose Dockerfile escape before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner refuses Compose unreviewed build SSH before creating application containers
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists no services as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing repository as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing Dockerfile as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing context as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing secret as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing Compose file as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing build target as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists build command failure as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner persists missing image as a failed job and preview with readable logs
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner fails an unhealthy Compose service and succeeds after editing the worktree recipe
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner imports a build target, env file, literal dollars, health dependency and internal volume without publishing repository ports
- packages/environments/tests/failures.e2e.test.ts › untrusted recipes and operational failures through the runner waits for actual HTTP health and records timeout instead of claiming a running container is ready
- packages/environments/tests/publication-docker.e2e.test.ts › publication through the runner process and a real Docker sandbox publishes a sandbox worktree through the host mirror while code in the sandbox never sees the token
- packages/environments/tests/railpack.test.ts › builds and runs a real Railpack image with public build variables
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E persists project-first configuration, validates revisions and authorizes every command over the socket
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E isolates multi-repository worktrees, preserves Git edits and reapplies resource/network limits
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E rejects existing and dangling symlink escapes for file writes without creating an outside target
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E preserves large UTF-8 contents across HTTP chunks when writing and reading a worktree file
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E builds a monorepo target, rebuilds image content, hot reloads development and rotates secrets without mixing environments
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E serves previews for descriptive task names through real Docker DNS and Traefik
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E marks real queued work failed after an abrupt runner death and permits retry
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E reports a real unavailable Docker endpoint without stopping the user daemon, then recovers
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E honors the configured workspace image and retries after replacing one without Git
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E reports an occupied proxy port and recovers after releasing it
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E rejects malformed commands and unknown resources without killing the process
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E refreshes HTTPS task bases inside the sandbox and reports a missing Git ref honestly
- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E builds a Railpack subdirectory with custom build/start commands and serves it through Traefik
- packages/environments/tests/workspace.e2e.test.ts › workspace operations in the Docker sandbox searches, reads by range, patches with preconditions and diffs inside the container
- packages/environments/tests/workspace.e2e.test.ts › workspace operations in the Docker sandbox fixes a bug proven by a failing test and binds the passing check to the exact revision
- packages/environments/tests/workspace.e2e.test.ts › workspace operations in the Docker sandbox classifies infrastructure failures, bounds long output and detects edits made during a check
- packages/environments/tests/workspace.e2e.test.ts › workspace operations in the Docker sandbox times out, stops a TERM-resistant process group and never reports it as passed
- packages/environments/tests/workspace.e2e.test.ts › workspace operations in the Docker sandbox reattaches a check that survived a runner restart and keeps its real result
- packages/environments/tests/workspace.e2e.test.ts › workspace operations in the Docker sandbox recovers a patch interrupted after the first write in the container

</details>

<details><summary>bots: 4 não executado(s)</summary>

- packages/bots/tests/evaluation.e2e.test.ts › evaluation harness in the Docker environment runs frozen cases through the real runner and skips what needs a real preview
- packages/bots/tests/programming.e2e.test.ts › programming run through worker, runner and Docker accepts over the channel, survives a disconnect and fixes the bug in the Docker sandbox
- packages/bots/tests/programming.e2e.test.ts › programming run through worker, runner and Docker recovers after the worker is killed during a check without repeating the edit
- packages/bots/tests/programming.test.ts › lets a bot create multi-repository worktrees, edit code, commit and enforce project boundaries in Docker

</details>

<details><summary>mcp-oinko: 1 não executado(s)</summary>

- packages/mcps/oinko/tests/runtime.test.ts › prepares GitHub through MCP and serves the selected worktree over real Docker and HTTP

</details>

## Docker real

| Suíte | Resultado | Aprovados | Falhas | Não executados | Duração |
| --- | --- | ---: | ---: | ---: | ---: |
| Docker: environments (runner, falhas, browser) | ⚠️ partial | 69 | 0 | 1 | 116s |
| Docker: worker + runner + harness | ✅ passed | 3 | 0 | 0 | 42s |

<details><summary>Docker: environments (runner, falhas, browser): 1 não executado(s)</summary>

- packages/environments/tests/runner.e2e.test.ts › runner process → Git/Docker/HTTP E2E builds a Railpack subdirectory with custom build/start commands and serves it through Traefik

</details>

## Provedor/serviços reais

| Suíte | Resultado | Aprovados | Falhas | Não executados | Duração |
| --- | --- | ---: | ---: | ---: | ---: |
| provedor real (3 repetições por caso) | ⚠️ partial | 0 | 0 | 1 | 0s |
| GitHub App real + repositório de teste | ⚠️ partial | 0 | 0 | 1 | 0s |
| Telegram real | ⚠️ partial | 0 | 0 | 1 | 0s |

<details><summary>provedor real (3 repetições por caso): 1 não executado(s)</summary>

- sem credencial de provedor configurada para avaliação; `pnpm --filter @oinko/bots evaluate --environment real` quando houver

</details>

<details><summary>GitHub App real + repositório de teste: 1 não executado(s)</summary>

- depende de App e instalação do operador

</details>

<details><summary>Telegram real: 1 não executado(s)</summary>

- depende de bot e conversa reais

</details>

## Aceite humano

| Suíte | Resultado | Aprovados | Falhas | Não executados | Duração |
| --- | --- | ---: | ---: | ---: | ---: |
| aceite humano (dashboard, diffs, PRs, fluxos) | ⚠️ partial | 0 | 0 | 1 | 0s |

<details><summary>aceite humano (dashboard, diffs, PRs, fluxos): 1 não executado(s)</summary>

- revisão do operador ainda não registrada

</details>

## Comandos

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/core-SDK-.json (em packages/oinko)`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/agent-runtime.json (em packages/agent-runtime)`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/workspaces.json (em packages/workspaces)`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/environments.json (em packages/environments)`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/bots.json (em packages/bots)`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/mcp-oinko.json (em packages/mcps/oinko)`
- `pnpm exec vitest run --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/dashboard-unit-.json (em apps/dashboard)`
- `grep de comparações com "dev"`
- `pnpm exec vitest run tests/docker.test.ts tests/runner.e2e.test.ts tests/failures.e2e.test.ts tests/browser.e2e.test.ts tests/workspace.e2e.test.ts tests/publication-docker.e2e.test.ts --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/Docker-environments-runner-falhas-browser-.json (em packages/environments)`
- `pnpm exec vitest run tests/programming.e2e.test.ts tests/evaluation.e2e.test.ts --reporter=json --outputFile=/var/folders/nh/krqdl17x477_v5w2sqn66tb00000gn/T/oinko-validation-li6a7L/Docker-worker-runner-harness.json (em packages/bots)`
- `pnpm exec playwright test --trace=off --reporter=json`

