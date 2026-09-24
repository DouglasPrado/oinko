/** Answer of the runner's `githubInstallation` (or its structured error). */
export interface GithubInstallationResult {
  ok: boolean;
  status?: string;
  installed?: boolean | null;
  installation?: { account?: string | null; suspended?: boolean; missingPermissions?: string[] };
  repositories?: { repositoryId: string; owner: string; name: string; access: 'valid' | 'denied' | 'unknown'; code?: string; message?: string }[];
  error?: { code: string; message: string };
}

const STATUS: Record<string, string> = {
  ready: 'Instalada e com acesso a todos os repositórios vinculados.',
  installation_not_configured: 'Informe o installation ID da GitHub App neste projeto.',
  installation_not_found: 'A instalação informada não existe (ou a App foi desinstalada).',
  installation_suspended: 'A instalação está suspensa no GitHub.',
  insufficient_permissions: 'A instalação existe, mas faltam permissões.',
  repositories_not_accessible: 'A instalação existe, mas não alcança todos os repositórios vinculados.',
  github_app_not_configured: 'A GitHub App da instância ainda não foi configurada no runner.',
  app_auth_failed: 'O GitHub recusou a autenticação da App (chave privada ou App ID).',
  clock_skew: 'O relógio desta máquina está defasado; o GitHub recusou o token.',
};

/**
 * Keeps "installed" apart from "can actually reach this repository": an
 * existing installation without access to a linked repository is not ready.
 */
export function describeGithubAccess(result: GithubInstallationResult) {
  const status = result.ok ? (result.status ?? 'unknown') : (result.error?.code ?? 'unknown');
  const installed = result.installed === true ? 'sim' : result.installed === false ? 'não' : 'desconhecido';
  return {
    status,
    ready: result.ok && status === 'ready',
    installed,
    summary: STATUS[status] ?? result.error?.message ?? `Estado: ${status}.`,
    missingPermissions: result.installation?.missingPermissions ?? [],
    repositories: (result.repositories ?? []).map((repository) => ({
      repositoryId: repository.repositoryId,
      label: `${repository.owner}/${repository.name}`,
      access: repository.access,
      text: repository.access === 'valid' ? 'acesso válido' : repository.access === 'denied' ? `sem acesso${repository.code ? ` (${repository.code})` : ''}` : 'acesso não verificado',
    })),
  };
}
