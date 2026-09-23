import { HttpError } from './errors';

interface ApiError {
  error?: { code?: string; message?: string };
}

/**
 * Unico lugar do cliente que chama `fetch`.
 *
 * Componente nao conhece HTTP: ele pede um dado e recebe o dado ou um erro
 * com mensagem apresentavel.
 */
export async function httpGet<T>(path: string): Promise<T> {
  const response = await fetch(path);

  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as ApiError;
    throw new HttpError(
      problem.error?.code ?? 'UNKNOWN',
      problem.error?.message ?? 'Nao foi possivel carregar o conteudo',
      response.status,
    );
  }

  return (await response.json()) as T;
}
