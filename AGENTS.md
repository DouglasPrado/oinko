# Instruções para agentes

Monorepo pnpm (Node 22.5+). Arquitetura, convenções e fontes de verdade estão em `CLAUDE.md` e `docs/blueprint/`.

## Antes de verificar

1. `pnpm install` na raiz.
2. `pnpm build:packages` na raiz. Apps e pacotes importam uns aos outros pelo `dist`: sem esse build, typecheck, lint, testes e build falham com `Cannot find module '@oinko/…'` e tipos não resolvidos. Esses erros não pedem mudança de import ou de código.

## Verificações

- Dashboard (`apps/dashboard`, Next.js): `pnpm --filter @oinko/dashboard typecheck`, `lint`, `test` e `build`.
- Um pacote: `pnpm --filter <nome-do-pacote> <script>` (por exemplo `@oinko/bots`, `@oinko/agent-runtime`).
- Repositório inteiro, só quando a mudança atravessa pacotes: `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Regras

- TypeScript; Zod é a única validação; arquivos em kebab-case; textos da interface em pt-BR.
- Teste antes do código quando mudar comportamento.
- Não faça push, PR, merge nem deploy sem autorização explícita.
- Não versione nada de `.harness/` (dados, chaves e bancos locais).
