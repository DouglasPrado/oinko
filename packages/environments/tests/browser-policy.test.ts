import { describe, expect, it } from 'vitest';
import type { Project } from '@oinko/workspaces';
import { NetworkPolicy, type PolicySource, type SessionScope } from '../src/browser/policy.js';
import type { Preview, Settings } from '../src/contracts/index.js';

function project(
  id: string,
  browser: Partial<NonNullable<Project['programming']>['browser']> = {},
) {
  return {
    id,
    name: id,
    repositories: [{ id: 'app', source: '/tmp/app', ref: 'HEAD' }],
    allowedBotIds: ['bot-a', 'bot-b'],
    programming: {
      commands: [],
      github: { repositories: [] },
      publisherBotIds: [],
      browser: { enabled: true, allowedOrigins: [], publicDocs: true, credentials: [], ...browser },
    },
  } as Project;
}
const settings: Settings = {
  id: 'settings',
  port: 3180,
  domain: '127.0.0.1.sslip.io',
  bindAddress: '127.0.0.1',
};
function preview(
  id: string,
  projectId: string,
  host: string,
  state: Preview['state'] = 'ready',
): Preview {
  return {
    id,
    projectId,
    taskId: `task-${id}`,
    environmentId: 'node',
    state,
    createdAt: '2026-09-24T00:00:00.000Z',
    urls: [{ serviceId: 'web', url: `http://${host}:3180` }],
  };
}

function setup(
  overrides: Partial<Record<string, Project>> = {},
  dns: Record<string, string[]> = {},
) {
  const projects: Record<string, Project | undefined> = {
    alpha: project('alpha', {
      allowedOrigins: [
        'https://staging.example.com',
        'http://127.0.0.1:4555',
        'http://10.1.2.3:8080',
      ],
    }),
    beta: project('beta'),
    ...overrides,
  };
  const previews = [
    preview('pa', 'alpha', 'web-aaaaaaaaaaaa.127.0.0.1.sslip.io'),
    preview('pb', 'beta', 'web-bbbbbbbbbbbb.127.0.0.1.sslip.io'),
    preview('pstopped', 'alpha', 'web-cccccccccccc.127.0.0.1.sslip.io', 'stopped'),
  ];
  const source: PolicySource = {
    project: (id) => projects[id],
    previews: () => previews,
    settings: () => settings,
  };
  const lookups: string[] = [];
  const resolve = async (host: string) => {
    lookups.push(host);
    const answer = dns[host];
    if (!answer) throw new Error('ENOTFOUND');
    return answer;
  };
  return { policy: new NetworkPolicy(source, resolve), projects, lookups };
}
const test: SessionScope = { sessionId: 's1', botId: 'bot-a', projectId: 'alpha', kind: 'test' };
const docs: SessionScope = { ...test, kind: 'docs' };

describe('NetworkPolicy', () => {
  it('maps READY previews of the session project to the local router, without DNS', async () => {
    const { policy, lookups } = setup();
    const decision = await policy.decide(test, {
      scheme: 'http',
      host: 'web-aaaaaaaaaaaa.127.0.0.1.sslip.io',
      port: 3180,
    });
    expect(decision).toMatchObject({
      allowed: true,
      rule: 'preview',
      code: 'preview',
      address: '127.0.0.1',
      port: 3180,
      origin: 'http://web-aaaaaaaaaaaa.127.0.0.1.sslip.io:3180',
      preview: { previewId: 'pa', taskId: 'task-pa', serviceId: 'web' },
    });
    expect(lookups).toEqual([]);
    // WebSocket upgrades (HMR) use CONNECT to the same preview host.
    expect(
      await policy.decide(test, {
        scheme: 'tunnel',
        host: 'web-aaaaaaaaaaaa.127.0.0.1.sslip.io',
        port: 3180,
      }),
    ).toMatchObject({ allowed: true, rule: 'preview' });
  });

  it('never opens previews of other projects, stopped previews or the router port itself', async () => {
    const { policy } = setup({}, { 'web-bbbbbbbbbbbb.127.0.0.1.sslip.io': ['127.0.0.1'] });
    for (const host of [
      'web-bbbbbbbbbbbb.127.0.0.1.sslip.io',
      'web-cccccccccccc.127.0.0.1.sslip.io',
    ])
      expect(await policy.decide(test, { scheme: 'http', host, port: 3180 })).toMatchObject({
        allowed: false,
      });
    expect(
      await policy.decide(test, { scheme: 'http', host: '127.0.0.1', port: 3180 }),
    ).toMatchObject({
      allowed: false,
      code: 'private_address',
    });
    // A docs session resolves the other project's preview name to loopback: still denied.
    expect(
      await policy.decide(docs, {
        scheme: 'http',
        host: 'web-bbbbbbbbbbbb.127.0.0.1.sslip.io',
        port: 80,
      }),
    ).toMatchObject({ allowed: false, code: 'private_address', rule: 'public_docs' });
  });

  it('allows configured origins; private targets only when the origin names the IP literally', async () => {
    const { policy } = setup({}, { 'staging.example.com': ['203.0.114.10'] });
    expect(
      await policy.decide(test, { scheme: 'tunnel', host: 'staging.example.com', port: 443 }),
    ).toMatchObject({
      allowed: true,
      rule: 'allowed_origin',
      address: '203.0.114.10',
      origin: 'https://staging.example.com',
    });
    expect(
      await policy.decide(test, { scheme: 'http', host: '127.0.0.1', port: 4555 }),
    ).toMatchObject({
      allowed: true,
      rule: 'allowed_origin',
      address: '127.0.0.1',
    });
    expect(
      await policy.decide(test, { scheme: 'http', host: '10.1.2.3', port: 8080 }),
    ).toMatchObject({
      allowed: true,
      address: '10.1.2.3',
    });
    // Same host, other port or scheme: not the configured origin.
    expect(
      await policy.decide(test, { scheme: 'http', host: '127.0.0.1', port: 4556 }),
    ).toMatchObject({
      allowed: false,
      code: 'private_address',
    });
    expect(
      await policy.decide(test, { scheme: 'http', host: 'staging.example.com', port: 80 }),
    ).toMatchObject({
      allowed: false,
      code: 'not_allowed',
    });
  });

  it('refuses a configured hostname that resolves to a private or metadata address (rebinding)', async () => {
    const { policy } = setup({}, { 'staging.example.com': ['10.0.0.8'] });
    expect(
      await policy.decide(test, { scheme: 'tunnel', host: 'staging.example.com', port: 443 }),
    ).toMatchObject({
      allowed: false,
      rule: 'allowed_origin',
      code: 'private_address',
    });
    const mixed = setup({}, { 'staging.example.com': ['203.0.114.10', '169.254.169.254'] });
    expect(
      await mixed.policy.decide(test, { scheme: 'tunnel', host: 'staging.example.com', port: 443 }),
    ).toMatchObject({ allowed: false, code: 'metadata_address' });
  });

  it('lets docs sessions reach public addresses on web ports only, never private or metadata ones', async () => {
    const { policy } = setup(
      {},
      {
        'docs.example.org': ['93.184.216.34', '2606:2800:220:1::1'],
        'intranet.example.org': ['192.168.0.20'],
        'meta.example.org': ['::ffff:169.254.169.254'],
      },
    );
    expect(
      await policy.decide(docs, { scheme: 'tunnel', host: 'docs.example.org', port: 443 }),
    ).toMatchObject({
      allowed: true,
      rule: 'public_docs',
      address: '93.184.216.34',
    });
    expect(
      await policy.decide(docs, { scheme: 'tunnel', host: 'docs.example.org', port: 22 }),
    ).toMatchObject({
      allowed: false,
      code: 'port_not_allowed',
    });
    expect(
      await policy.decide(docs, { scheme: 'http', host: 'intranet.example.org', port: 80 }),
    ).toMatchObject({
      allowed: false,
      code: 'private_address',
    });
    expect(
      await policy.decide(docs, { scheme: 'http', host: 'meta.example.org', port: 80 }),
    ).toMatchObject({
      allowed: false,
      code: 'metadata_address',
    });
    expect(
      await policy.decide(docs, { scheme: 'http', host: 'missing.example.org', port: 80 }),
    ).toMatchObject({
      allowed: false,
      code: 'dns_failure',
    });
  });

  it('keeps test sessions to previews and allowed origins, and honours publicDocs=false', async () => {
    const dns = { 'docs.example.org': ['93.184.216.34'] };
    const { policy, lookups } = setup({}, dns);
    expect(
      await policy.decide(test, { scheme: 'tunnel', host: 'docs.example.org', port: 443 }),
    ).toMatchObject({
      allowed: false,
      rule: 'default',
      code: 'not_allowed',
    });
    expect(lookups).toEqual([]);
    const closed = setup({ alpha: project('alpha', { publicDocs: false }) }, dns);
    expect(
      await closed.policy.decide(docs, { scheme: 'tunnel', host: 'docs.example.org', port: 443 }),
    ).toMatchObject({ allowed: false, code: 'not_allowed' });
  });

  it('denies metadata, link-local, loopback names and IPv6/mapped private literals without resolving', async () => {
    const { policy, lookups } = setup();
    const cases: [string, number, string][] = [
      ['169.254.169.254', 80, 'metadata_address'],
      ['[fd00:ec2::254]', 80, 'metadata_address'],
      ['169.254.1.1', 80, 'forbidden_address'],
      ['0.0.0.0', 80, 'forbidden_address'],
      ['[::1]', 80, 'private_address'],
      ['[::ffff:127.0.0.1]', 80, 'private_address'],
      ['[fe80::1]', 80, 'forbidden_address'],
      ['[fc00::5]', 443, 'private_address'],
      ['localhost', 3000, 'private_address'],
      ['app.localhost', 3000, 'private_address'],
      ['192.168.1.1', 443, 'private_address'],
      ['100.64.1.1', 443, 'private_address'],
    ];
    for (const [host, port, code] of cases) {
      for (const scope of [test, docs])
        expect(await policy.decide(scope, { scheme: 'tunnel', host, port }), host).toMatchObject({
          allowed: false,
          code,
        });
    }
    expect(lookups).toEqual([]);
    expect(await policy.decide(test, { scheme: 'http', host: 'bad host', port: 80 })).toMatchObject(
      {
        allowed: false,
        code: 'invalid_target',
      },
    );
    expect(await policy.decide(test, { scheme: 'http', host: 'a.example', port: 0 })).toMatchObject(
      {
        allowed: false,
        code: 'invalid_target',
      },
    );
  });

  it('re-reads project access on every decision: revocation and disabling end access immediately', async () => {
    const { policy, projects } = setup();
    const target = {
      scheme: 'http' as const,
      host: 'web-aaaaaaaaaaaa.127.0.0.1.sslip.io',
      port: 3180,
    };
    expect((await policy.decide(test, target)).allowed).toBe(true);
    projects.alpha = { ...projects.alpha!, allowedBotIds: ['bot-b'] };
    expect(await policy.decide(test, target)).toMatchObject({
      allowed: false,
      code: 'access_revoked',
    });
    projects.alpha = project('alpha', { enabled: false });
    expect(await policy.decide(test, target)).toMatchObject({
      allowed: false,
      code: 'browser_disabled',
    });
    projects.alpha = undefined;
    expect(await policy.decide(test, target)).toMatchObject({
      allowed: false,
      code: 'access_revoked',
    });
  });

  it('binds a URL to its preview for evidence', () => {
    const { policy } = setup();
    expect(
      policy.previewFor('alpha', 'http://web-aaaaaaaaaaaa.127.0.0.1.sslip.io:3180/login?x=1'),
    ).toMatchObject({
      previewId: 'pa',
      taskId: 'task-pa',
      environmentId: 'node',
      serviceId: 'web',
    });
    expect(
      policy.previewFor('beta', 'http://web-aaaaaaaaaaaa.127.0.0.1.sslip.io:3180/'),
    ).toBeUndefined();
    expect(policy.previewFor('alpha', 'about:blank')).toBeUndefined();
  });
});
