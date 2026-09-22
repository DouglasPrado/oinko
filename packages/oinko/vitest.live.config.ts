import { defineConfig } from 'vitest/config';

/**
 * Suite que fala com os provedores de verdade.
 *
 * Fora da suite normal de proposito: cada execucao gasta tokens e exige rede e
 * credenciais. `pnpm test` continua offline, deterministico e gratuito; esta
 * roda quando alguem quer saber o que funciona de fato ponta a ponta.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/live/**/*.live.test.ts'],
    // Um turno com modelo de raciocinio mais extracao em background passa
    // folgado dos 5s padrao.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Em serie: varios agentes concorrentes contra o mesmo provedor produzem
    // rate limit, que apareceria como falha de funcionalidade.
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
