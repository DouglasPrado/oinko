import { describe, expect, it } from 'vitest';
import { describeGithubAccess } from './github-access';

describe('GitHub access summary', () => {
  it('separates an existing installation from effective access to each repository', () => {
    const view = describeGithubAccess({
      ok: true,
      status: 'repositories_not_accessible',
      installed: true,
      repositories: [
        { repositoryId: 'app', owner: 'acme', name: 'app', access: 'valid' },
        { repositoryId: 'api', owner: 'acme', name: 'api', access: 'denied', code: 'repository_not_accessible' },
      ],
    });
    expect(view).toMatchObject({ ready: false, installed: 'sim' });
    expect(view.summary).toMatch(/não alcança/);
    expect(view.repositories.map((item) => item.text)).toEqual(['acesso válido', 'sem acesso (repository_not_accessible)']);
  });

  it('is ready only when every linked repository is reachable and reports configuration errors plainly', () => {
    expect(describeGithubAccess({ ok: true, status: 'ready', installed: true, repositories: [{ repositoryId: 'app', owner: 'acme', name: 'app', access: 'valid' }] }).ready).toBe(true);
    const unconfigured = describeGithubAccess({ ok: false, error: { code: 'github_app_not_configured', message: 'x' } });
    expect(unconfigured).toMatchObject({ ready: false, installed: 'desconhecido' });
    expect(unconfigured.summary).toMatch(/não foi configurada/);
    expect(describeGithubAccess({ ok: true, status: 'installation_not_found', installed: false }).installed).toBe('não');
  });
});
