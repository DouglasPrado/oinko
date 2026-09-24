import type { Criterion, Publication } from './contracts.js';
import type { Evidence } from './evidence.js';

const CHECK_LABEL: Record<string, string> = {
  passed: 'aprovado',
  failed: 'reprovado',
  skipped: 'não executado (skipped)',
  timeout: 'tempo esgotado',
  infrastructure: 'falha de infraestrutura',
};
const CI_LABEL: Record<string, string> = {
  passed: 'CI aprovado',
  failed: 'CI reprovado',
  cancelled: 'CI cancelado',
  queued: 'CI na fila — draft não validado integralmente',
  running: 'CI em andamento — draft não validado integralmente',
  unknown: 'sem resultado de CI — draft não validado integralmente',
  unavailable: 'CI indisponível no momento — draft não validado integralmente',
  superseded: 'CI de um commit anterior — não vale para o atual',
};

/**
 * What was really delivered, from evidence only: checks with their true
 * result (skipped and infrastructure are never "ok"), functional flows,
 * draft PR links with the CI state of their exact commit, and what is
 * still pending. Used in final messages to channels.
 */
export function deliveryReport(input: {
  criteria: readonly Criterion[];
  evidence: readonly Evidence[];
  publications: readonly Publication[];
  link?: string;
}): string {
  const lines: string[] = [];
  const checks = new Map<string, Extract<Evidence, { kind: 'check' }>>();
  const flows = new Map<string, Extract<Evidence, { kind: 'functional' }>>();
  const ci = new Map<string, Extract<Evidence, { kind: 'publication' }>>();
  for (const item of input.evidence) {
    if (item.kind === 'check') checks.set(`${item.repositoryId}:${item.checkKind}`, item);
    else if (item.kind === 'functional') flows.set(item.criterionId ?? item.fingerprint, item);
    else if (item.kind === 'publication') ci.set(item.repositoryId, item);
  }
  const multiRepo = new Set([...checks.values()].map((item) => item.repositoryId)).size > 1;
  if (checks.size)
    lines.push(
      `Verificações: ${[...checks.values()]
        .map((item) => `${multiRepo ? `${item.repositoryId}/` : ''}${item.checkKind} ${CHECK_LABEL[item.result] ?? item.result}`)
        .join(', ')}`,
    );
  for (const flow of flows.values())
    lines.push(`Fluxo ${flow.description ?? flow.criterionId ?? ''}: ${flow.result === 'passed' ? 'aprovado' : 'reprovado'}${flow.viewport ? ` (${flow.viewport})` : ''}`);
  for (const publication of input.publications) {
    const state = ci.get(publication.repositoryId);
    const label = state?.validated ? 'CI aprovado (validado integralmente)' : (CI_LABEL[state?.ci ?? 'unknown'] ?? `CI ${state?.ci}`);
    lines.push(`Draft PR ${publication.repositoryId}: ${publication.prUrl ?? 'sem PR aberto'} — ${label}`);
  }
  const pending = input.criteria.filter((criterion) => criterion.status !== 'satisfied');
  if (pending.length) lines.push(`Pendências: ${pending.map((criterion) => `${criterion.description} (${criterion.status})`).join('; ')}`);
  if (input.link) lines.push(`Detalhes: ${input.link}`);
  return lines.join('\n');
}
