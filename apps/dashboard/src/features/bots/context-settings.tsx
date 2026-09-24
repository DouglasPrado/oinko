'use client';

import { ContextPolicySchema, type ContextPolicy } from '@oinko/core/context-policy';
import type { BotDefinition, BotSecrets } from '@oinko/bots/schema';
import { Field, inputStyle } from '@/features/projects/shared';
import { SwitchField } from '@/components/shared/switch-field';

const NUMBERS = [
  ['maxInputTokens', 'Orçamento de contexto', 4096, 128000],
  ['fastInputTokens', 'Orçamento fast', 2048, 128000],
  ['recentTokens', 'Janela recente', 512, 64000],
  ['summaryTokens', 'Tamanho do resumo', 256, 8000],
  ['toolResultChars', 'Caracteres por resultado antigo', 512, 20000],
  ['maxTools', 'Ferramentas na seleção inicial', 1, 64],
] as const;

export function ContextSettings({
  definition,
  onChange,
  secrets,
  onSecrets,
  hasTypesafeKey,
}: {
  definition: BotDefinition;
  onChange: (changes: Partial<BotDefinition>) => void;
  secrets: BotSecrets;
  onSecrets: (changes: Partial<BotSecrets>) => void;
  hasTypesafeKey: boolean;
}) {
  const context = definition.context ?? ContextPolicySchema.parse({});
  const change = (values: Partial<ContextPolicy>) =>
    onChange({ context: { ...context, ...values } });
  const intelligence = definition.intelligence ?? { enabled: false, minConfidence: 0.85 };
  return (
    <section className="rounded-xl border border-rule" aria-label="Contexto e ferramentas">
      <header className="border-b border-rule px-5 py-3.5">
        <h3 className="text-sm font-semibold">Contexto e ferramentas</h3>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Preserva a conversa completa e envia à IA um resumo com as interações recentes. Reinicie o
          bot após salvar.
        </p>
      </header>
      <div className="space-y-4 p-5">
        <SwitchField
          label="Otimizar contexto"
          description="Resume o histórico antigo e permite recuperar detalhes quando necessário."
          checked={context.enabled}
          onChange={(event) => change({ enabled: event.target.checked })}
        />
        {context.enabled && (
          <>
            <p className="text-xs text-ink-muted">
              Os orçamentos são estimativas em tokens. Mensagens atuais e instruções essenciais
              podem exigir mais espaço; isso será indicado na telemetria.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {NUMBERS.map(([key, label, min, max]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    className={inputStyle}
                    min={min}
                    max={max}
                    required
                    value={context[key]}
                    onChange={(event) => change({ [key]: Number(event.target.value) })}
                  />
                </Field>
              ))}
            </div>
            <SwitchField
              label="Selecionar ferramentas com Jev"
              description="Carrega as ferramentas relevantes e permite descobrir outras durante a tarefa."
              checked={context.selectTools}
              onChange={(event) => change({ selectTools: event.target.checked })}
            />
            {context.selectTools && !intelligence.enabled && (
              <p className="text-xs text-ink-muted">
                Habilite o Jev abaixo para selecionar ferramentas. Enquanto estiver desligado, o bot
                mantém todas as ferramentas disponíveis.
              </p>
            )}
            <Field
              label="Confiança para seleção"
              help="Decisões incertas mantêm ferramentas candidatas disponíveis na seleção inicial."
            >
              <input
                type="number"
                className={inputStyle}
                min={0}
                max={1}
                step="0.05"
                required
                value={context.minToolConfidence}
                onChange={(event) => change({ minToolConfidence: Number(event.target.value) })}
              />
            </Field>
          </>
        )}
        <SwitchField
          label="Usar Jev"
          description="Decide o roteamento de modelo e, quando habilitada acima, a seleção de ferramentas."
          checked={intelligence.enabled}
          onChange={(event) =>
            onChange({ intelligence: { ...intelligence, enabled: event.target.checked } })
          }
        />
        {intelligence.enabled && (
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Modelo fast"
              help="Opcional. Use o identificador do provedor configurado."
            >
              <input
                className={inputStyle}
                value={intelligence.fastModel ?? ''}
                onChange={(event) =>
                  onChange({
                    intelligence: { ...intelligence, fastModel: event.target.value || undefined },
                  })
                }
              />
            </Field>
            <Field label="Confiança para modelo fast">
              <input
                type="number"
                className={inputStyle}
                min={0}
                max={1}
                step="0.05"
                value={intelligence.minConfidence}
                onChange={(event) =>
                  onChange({
                    intelligence: { ...intelligence, minConfidence: Number(event.target.value) },
                  })
                }
              />
            </Field>
            <Field
              label="Chave da TypeSafe"
              help={
                hasTypesafeKey
                  ? 'Configurada. Deixe em branco para manter.'
                  : 'Credencial do Jev, independente da chave do modelo.'
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                className={inputStyle}
                value={secrets.typesafeKey ?? ''}
                onChange={(event) => onSecrets({ typesafeKey: event.target.value })}
              />
            </Field>
          </div>
        )}
      </div>
    </section>
  );
}
