import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.OINKO_NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  serverExternalPackages: [
    '@oinko/core',
    '@oinko/bots',
    '@oinko/agent-runtime',
    '@oinko/workspaces',
    '@oinko/environments',
  ],
  // O repo ja tem CLAUDE.md proprio na raiz, com as regras que valem aqui.
  // Um arquivo gerado por framework ao lado dele so cria duas fontes de verdade.
  agentRules: false,
  poweredByHeader: false,
  headers() {
    // Telemetria e conteudo de conversa: nada disso deve ser indexado.
    return Promise.resolve([
      { source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ]);
  },
};

export default nextConfig;
