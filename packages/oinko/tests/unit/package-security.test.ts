import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as Record<
  string,
  unknown
>;

// Repo standalone: o que este teste protege sao os `overrides` do package.json
// publicado — as unicas pinagens que chegam a quem instala o pacote.
//
// As assercoes antigas sobre `pnpm-workspace.yaml` e `.github/workflows/release.yml`
// sairam junto com o monorepo. Elas liam a raiz do gba.dev por caminho relativo
// (`../../../..`) no topo do modulo, entao aqui dariam ENOENT na COLETA: o vitest
// reportaria "0 test" com falha, sem nome de teste nenhum.

describe('package.json security overrides (issue #26)', () => {
  it('should have a top-level "overrides" field for npm compatibility', () => {
    expect(pkg).toHaveProperty('overrides');
    expect(typeof pkg.overrides).toBe('object');
  });

  it('should pin hono to >=4.12.16 to fix GHSA-26pp, GHSA-r5rp, GHSA-xf4j, GHSA-wmmm, GHSA-458j, GHSA-xpcf, GHSA-9vqf, GHSA-69xw', () => {
    const overrides = pkg.overrides as Record<string, string>;
    expect(overrides).toHaveProperty('hono');
    // Must satisfy >=4.12.16 (minimum for all hono CVEs including issue #143)
    expect(overrides.hono).toBe('>=4.12.16');
  });

  it('should pin @hono/node-server to >=1.19.13 to fix GHSA-92pp', () => {
    const overrides = pkg.overrides as Record<string, string>;
    expect(overrides).toHaveProperty('@hono/node-server');
    expect(overrides['@hono/node-server']).toBe('>=1.19.13');
  });

  it('should pin postcss to >=8.5.10 to fix GHSA-qx2v', () => {
    const overrides = pkg.overrides as Record<string, string>;
    expect(overrides).toHaveProperty('postcss');
    expect(overrides.postcss).toBe('>=8.5.10');
  });
});

describe('overrides — hono >=4.12.16 (GHSA-9vqf + GHSA-69xw) (issue #143)', () => {
  it('pins hono to >=4.12.16 in top-level overrides for npm compatibility (issue #143)', () => {
    const overrides = pkg.overrides as Record<string, string>;
    expect(overrides.hono).toMatch(/^>=4\.12\.(1[6-9]|[2-9]\d|\d{3,})/);
  });
});

describe('overrides — CVE-2026-42338 ip-address XSS (issue #115)', () => {
  it('should pin ip-address in top-level overrides for npm compatibility (issue #115)', () => {
    const overrides = pkg.overrides as Record<string, string>;
    expect(overrides).toHaveProperty('ip-address');
    expect(overrides['ip-address']).toBe('>=10.1.1');
  });
});

describe('overrides — CVE-2026-6321 + CVE-2026-6322 fast-uri path-traversal & host-confusion (issue #163)', () => {
  it('pins fast-uri to >=3.1.2 in top-level overrides for npm compatibility (issue #163)', () => {
    const overrides = pkg.overrides as Record<string, string>;
    expect(overrides).toHaveProperty('fast-uri');
    expect(overrides['fast-uri']).toBe('>=3.1.2');
  });
});
