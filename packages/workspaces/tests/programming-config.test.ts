import { expect, it } from 'vitest';
import { ProjectSchema } from '../src/index.js';

const project = {
  id: 'loja',
  name: 'Loja',
  repositories: [
    { id: 'app', source: 'https://example.com/loja.git' },
    { id: 'api', source: 'https://example.com/api.git' },
  ],
  allowedBotIds: ['alpha', 'beta'],
};

it('keeps legacy projects valid and grants no programming capability by omission', () => {
  const parsed = ProjectSchema.parse(project);
  expect(parsed.programming).toBeUndefined();
});

it('accepts per-package commands, browser origins, GitHub links and publishers', () => {
  const parsed = ProjectSchema.parse({
    ...project,
    programming: {
      commands: [{ repositoryId: 'app', path: 'packages/web', kind: 'test', command: 'pnpm test' }],
      browser: { enabled: true, allowedOrigins: ['https://docs.example.com'] },
      github: { installationId: 42, repositories: [{ repositoryId: 'app', owner: 'acme', name: 'loja' }] },
      publisherBotIds: ['alpha'],
    },
  });
  expect(parsed.programming?.github.repositories[0]?.baseBranch).toBe('main');
  expect(parsed.programming?.browser.publicDocs).toBe(true);
  expect(parsed.programming?.commands[0]?.path).toBe('packages/web');
});

it('rejects references outside the project and publishers that are not authorized', () => {
  const bad = [
    { commands: [{ repositoryId: 'ghost', kind: 'test', command: 'x' }] },
    { github: { repositories: [{ repositoryId: 'ghost', owner: 'acme', name: 'x' }] } },
    { publisherBotIds: ['intruder'] },
    { commands: [{ repositoryId: 'app', path: '../escape', kind: 'test', command: 'x' }] },
    { browser: { allowedOrigins: ['https://user:pass@example.com'] } },
    { browser: { allowedOrigins: ['file:///etc/passwd'] } },
    { browser: { allowedOrigins: ['https://example.com/path'] } },
  ];
  for (const programming of bad)
    expect(() => ProjectSchema.parse({ ...project, programming }), JSON.stringify(programming)).toThrow();
});
