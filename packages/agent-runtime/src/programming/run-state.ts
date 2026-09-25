import type { Criterion } from './contracts.js';
import type { Evidence } from './evidence.js';

const DEFAULT_CHECKS = ['test', 'typecheck', 'lint', 'build'] as const;

export interface RunStateInput {
  criteria: readonly Criterion[];
  evidence: readonly Evidence[];
  /** Latest known revision per repository. */
  revisions: ReadonlyMap<string, string>;
}

/** What satisfies an open criterion, in the words of the tools that do it. */
export function criterionGuidance(criterion: Criterion): string {
  if (criterion.status === 'satisfied') return 'satisfeito';
  switch (criterion.kind) {
    case 'diff':
      return 'nenhuma edição registrada na revisão atual: edite com workspace_replace ou workspace_patch (um comando que altere arquivos também conta; commit não conta como edição)';
    case 'check': {
      const kinds = criterion.id === 'checks' ? DEFAULT_CHECKS.join(', ') : criterion.id;
      return criterion.status === 'failed'
        ? `falhou na revisão atual: corrija os erros listados e rode workspace_check de novo (${kinds}, os que o projeto tiver)`
        : `nenhuma verificação na revisão atual: rode workspace_check (${kinds}, os que o projeto tiver); verificações de revisões anteriores não valem`;
    }
    case 'functional':
      return 'valide com functional_check na prévia construída da revisão atual';
    case 'publication':
      return 'publique em draft PR com publication_publish (só quando o run autoriza publicar)';
    case 'analysis':
      return 'entregue o relatório completo em programming_complete (campo report)';
    default:
      return 'depende de uma confirmação da pessoa';
  }
}

/**
 * The run's recorded facts as the agent should start a cycle from them: the
 * current revision, what the run changed, which checks speak for the code
 * now (with their first errors) and what each open criterion needs.
 */
export function describeRunState(input: RunStateInput): string {
  const lines: string[] = ['Estado atual (fatos registrados pela plataforma; não precisa redescobrir com git status ou ls):'];
  const repositories = new Set([...input.revisions.keys()]);
  for (const item of input.evidence) if (item.kind === 'edit' || item.kind === 'check') repositories.add(item.repositoryId);
  for (const repositoryId of repositories) {
    const revision = input.revisions.get(repositoryId);
    lines.push(`- ${repositoryId}: revisão atual ${revision ?? 'ainda não observada'}`);
    const edited = new Set<string>();
    for (const item of input.evidence) if (item.kind === 'edit' && item.repositoryId === repositoryId) for (const path of item.paths) edited.add(path);
    lines.push(`  Arquivos alterados pelo run: ${edited.size ? [...edited].sort().slice(0, 30).join(', ') : 'nenhum'}`);
    const latest = new Map<string, Extract<Evidence, { kind: 'check' }>>();
    for (const item of input.evidence)
      if (item.kind === 'check' && item.repositoryId === repositoryId && item.revision === revision) latest.set(item.checkKind, item);
    const kinds = [...new Set([...DEFAULT_CHECKS, ...latest.keys()])];
    lines.push('  Verificações desta revisão:');
    for (const kind of kinds) {
      const item = latest.get(kind);
      if (!item) {
        lines.push(`  - ${kind}: não rodado nesta revisão`);
        continue;
      }
      lines.push(`  - ${kind}: ${item.result}`);
      for (const error of (item.errors ?? []).slice(0, 5)) lines.push(`      ${error.slice(0, 240)}`);
    }
  }
  const open = input.criteria.filter((criterion) => criterion.status !== 'satisfied');
  if (input.criteria.length && !open.length)
    lines.push('Todos os critérios estão satisfeitos na revisão atual: chame programming_complete agora, sem outras mudanças.');
  else {
    lines.push('Critérios:');
    for (const criterion of input.criteria) lines.push(`- ${criterion.id} [${criterion.status}]: ${criterionGuidance(criterion)}`);
  }
  return lines.join('\n');
}
