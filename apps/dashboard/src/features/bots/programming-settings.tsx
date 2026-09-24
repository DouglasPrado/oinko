'use client';

import { useQuery } from '@tanstack/react-query';
import {
  ProgrammingPolicySchema,
  type ProgrammingPolicy,
} from '@oinko/agent-runtime/programming-policy';
import type { BotDefinition } from '@oinko/bots/schema';
import { Field, inputStyle } from '@/features/projects/shared';
import { SwitchField } from '@/components/shared/switch-field';
import { cn } from '@/lib/utils/cn';

interface EffectiveView {
  projects: {
    projectId: string;
    version?: string;
    error?: string;
    policy?: { allowEdits: boolean; allowPublication: boolean; allowBrowser: boolean; autoResume: boolean; models: { main: string; fast?: string } };
  }[];
}

const AUTONOMY: Record<ProgrammingPolicy['autonomy'], string> = {
  analysis: 'Somente análise (não altera projetos)',
  edit: 'Editar e validar na worktree',
  draft_pr: 'Editar, validar e entregar em draft PR (quando o projeto autorizar)',
};

/**
 * Durable programming runs for this bot. Everything is per-bot configuration
 * over the same platform code; there is no spending ceiling by design.
 */
export function ProgrammingSettings({
  definition,
  onChange,
  botId,
}: {
  definition: BotDefinition;
  onChange: (changes: Partial<BotDefinition>) => void;
  botId?: string;
}) {
  const policy = definition.programmingPolicy ?? ProgrammingPolicySchema.parse({});
  const change = (values: Partial<ProgrammingPolicy>) =>
    onChange({ programmingPolicy: ProgrammingPolicySchema.parse({ ...policy, ...values }) });
  const effective = useQuery({
    queryKey: ['programming-policy', botId],
    queryFn: async () => (await (await fetch(`/api/programming/policy?botId=${encodeURIComponent(botId!)}`, { cache: 'no-store' })).json()) as EffectiveView,
    enabled: !!botId && policy.enabled,
  });
  const number = (value: string, fallback: number) => (Number.isFinite(Number(value)) && value !== '' ? Number(value) : fallback);
  return (
    <div className="space-y-4" aria-label="Trabalhos de programação">
      <SwitchField
        label="Trabalhos de programação duráveis"
        description="Aceita trabalho em segundo plano com fila, ciclos, evidências e retomada. Um trabalho ativo por bot. Reinicie o bot para aplicar."
        checked={policy.enabled}
        onChange={(event) => change({ enabled: event.target.checked })}
      />
      {policy.enabled && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Autonomia" help="Merge, deploy e operações destrutivas nunca são automáticos.">
              <select
                className={inputStyle}
                value={policy.autonomy}
                onChange={(event) => change({ autonomy: event.target.value as ProgrammingPolicy['autonomy'] })}
              >
                {Object.entries(AUTONOMY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Progresso nos canais">
              <select
                className={inputStyle}
                value={policy.notifications.progress}
                onChange={(event) =>
                  change({ notifications: { ...policy.notifications, progress: event.target.value as ProgrammingPolicy['notifications']['progress'] } })
                }
              >
                <option value="relevant">Mudanças relevantes</option>
                <option value="final">Somente resultado final e bloqueios</option>
                <option value="none">Não notificar</option>
              </select>
            </Field>
            <Field label="Modelo principal" help="Em branco usa o modelo do bot.">
              <input
                className={cn(inputStyle, 'font-mono')}
                value={policy.models.main ?? ''}
                onChange={(event) => change({ models: { ...policy.models, main: event.target.value.trim() || undefined } })}
                placeholder={definition.model || 'modelo do bot'}
              />
            </Field>
            <Field label="Modelo rápido" help="Opcional; troca para o principal após o limite sem saída útil.">
              <input
                className={cn(inputStyle, 'font-mono')}
                value={policy.models.fast ?? ''}
                onChange={(event) => change({ models: { ...policy.models, fast: event.target.value.trim() || undefined } })}
              />
            </Field>
            <Field label="Fallback após (segundos sem saída útil)">
              <input
                type="number"
                min={1}
                max={120}
                className={inputStyle}
                value={policy.models.fallbackAfterMs / 1000}
                onChange={(event) => change({ models: { ...policy.models, fallbackAfterMs: number(event.target.value, 15) * 1000 } })}
              />
            </Field>
            <Field label="Iterações por ciclo" help="Limite técnico de um ciclo; o trabalho continua no próximo.">
              <input
                type="number"
                min={1}
                max={200}
                className={inputStyle}
                value={policy.cycle.maxIterations}
                onChange={(event) => change({ cycle: { ...policy.cycle, maxIterations: number(event.target.value, 12) } })}
              />
            </Field>
            <Field label="Ciclos sem progresso até bloquear">
              <input
                type="number"
                min={1}
                max={10}
                className={inputStyle}
                value={policy.cycle.noProgressLimit}
                onChange={(event) => change({ cycle: { ...policy.cycle, noProgressLimit: number(event.target.value, 3) } })}
              />
            </Field>
            <Field label="Tempo máximo por comando (segundos)">
              <input
                type="number"
                min={1}
                max={3600}
                className={inputStyle}
                value={policy.cycle.commandTimeoutSeconds}
                onChange={(event) => change({ cycle: { ...policy.cycle, commandTimeoutSeconds: number(event.target.value, 600) } })}
              />
            </Field>
          </div>
          <SwitchField
            label="Retomar automaticamente após reinício"
            description="Depois de reconciliar operações incertas e conferir permissões."
            checked={policy.autoResume}
            onChange={(event) => change({ autoResume: event.target.checked })}
          />
          <SwitchField
            label="Browser para prévias e documentação"
            description="Só vale em projetos com browser habilitado."
            checked={policy.capabilities.browser}
            onChange={(event) => change({ capabilities: { ...policy.capabilities, browser: event.target.checked } })}
          />
          <SwitchField
            label="Publicar draft PR"
            description="Só vale em projetos que autorizem este bot a publicar."
            checked={policy.capabilities.publication}
            onChange={(event) => change({ capabilities: { ...policy.capabilities, publication: event.target.checked } })}
          />
          <p className="text-xs text-ink-muted">
            Não há teto de gasto: tokens e custos são medidos e exibidos em cada trabalho, com custos desconhecidos identificados.
          </p>
          {botId && effective.data && (
            <div className="rounded-lg border border-rule" aria-label="Política efetiva por projeto">
              <p className="border-b border-rule px-4 py-2 text-[13px] font-medium">Política efetiva por projeto (versão salva)</p>
              <ul className="divide-y divide-rule text-xs">
                {effective.data.projects.map((project) => (
                  <li key={project.projectId} className="px-4 py-2">
                    <span className="font-mono text-ink">{project.projectId}</span>{' '}
                    {project.error ? (
                      <span className="text-error-ink">{project.error}</span>
                    ) : (
                      <span className="text-ink-muted">
                        edita: {project.policy!.allowEdits ? 'sim' : 'não'} · draft PR: {project.policy!.allowPublication ? 'sim' : 'não'} · browser:{' '}
                        {project.policy!.allowBrowser ? 'sim' : 'não'} · modelo {project.policy!.models.main}
                        {project.policy!.models.fast ? ` / ${project.policy!.models.fast}` : ''}
                      </span>
                    )}
                  </li>
                ))}
                {!effective.data.projects.length && <li className="px-4 py-2 text-ink-muted">Nenhum projeto autoriza este bot ainda.</li>}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
