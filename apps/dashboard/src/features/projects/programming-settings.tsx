'use client';
import { useState } from 'react';
import {
  ProjectProgrammingSchema,
  type Project,
  type ProjectProgramming,
} from '@oinko/workspaces/contracts';
import { SwitchField, SwitchList } from '@/components/shared/switch-field';
import { Field, inputStyle, panelStyle, textareaStyle } from './shared';

const KINDS = ['install', 'test', 'lint', 'build', 'typecheck', 'format'] as const;

/** `app:packages/web:test = pnpm --filter web test`, one per line. */
export function commandsText(commands: ProjectProgramming['commands']): string {
  return commands.map((entry) => `${entry.repositoryId}:${entry.path}:${entry.kind} = ${entry.command}`).join('\n');
}
export function parseCommands(text: string): ProjectProgramming['commands'] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const match = /^([a-z][a-z0-9-]*):([^:]+):([a-z]+)\s*=\s*(.+)$/.exec(line);
      if (!match || !(KINDS as readonly string[]).includes(match[3]!))
        throw new Error(`Comando inválido: "${line}". Use repositório:caminho:tipo = comando.`);
      return { repositoryId: match[1]!, path: match[2]!.trim(), kind: match[3] as (typeof KINDS)[number], command: match[4]!.trim() };
    });
}
const list = (text: string) =>
  text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Programming configuration owned by the project: explicit commands per
 * package (they win over detection), browser access, GitHub links and which
 * authorized bots may publish draft PRs.
 */
export function ProjectProgrammingSettings({
  definition,
  onChange,
  bots,
}: {
  definition: Project;
  onChange: (programming: ProjectProgramming) => void;
  bots: { id: string; name: string }[];
}) {
  const programming = definition.programming ?? ProjectProgrammingSchema.parse({});
  const [commands, setCommands] = useState(commandsText(programming.commands));
  const [commandError, setCommandError] = useState('');
  const update = (values: Partial<ProjectProgramming>) => onChange({ ...programming, ...values });
  const github = (repositoryId: string) => programming.github.repositories.find((entry) => entry.repositoryId === repositoryId);
  return (
    <section className={panelStyle} aria-label="Programação do projeto">
      <h3 className="text-sm font-semibold">Programação</h3>
      <p className="-mt-3 text-[13px] text-ink-muted">
        Vale para todos os bots autorizados. Comandos informados aqui prevalecem sobre os detectados nos manifests.
      </p>
      <Field label="Comandos por pacote" help="Um por linha: repositório:caminho:tipo = comando. Tipos: install, test, lint, build, typecheck, format.">
        <textarea
          className={`${textareaStyle} min-h-24 font-mono text-xs`}
          value={commands}
          onChange={(event) => {
            setCommands(event.target.value);
            try {
              update({ commands: parseCommands(event.target.value) });
              setCommandError('');
            } catch (error) {
              setCommandError(error instanceof Error ? error.message : 'Comando inválido.');
            }
          }}
          placeholder="app:packages/web:test = pnpm --filter web test"
        />
      </Field>
      {commandError && (
        <p role="alert" className="-mt-2 text-xs text-error-ink">
          {commandError}
        </p>
      )}
      <SwitchField
        label="Browser para prévias"
        description="Permite testar as prévias deste projeto em browser isolado."
        checked={programming.browser.enabled}
        onChange={(event) => update({ browser: { ...programming.browser, enabled: event.target.checked } })}
      />
      {programming.browser.enabled && (
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Origens adicionais permitidas" help="Separadas por vírgula, como https://docs.exemplo.com. Nunca uma rede inteira.">
            <input
              className={inputStyle}
              defaultValue={programming.browser.allowedOrigins.join(', ')}
              onBlur={(event) => update({ browser: { ...programming.browser, allowedOrigins: list(event.target.value) } })}
            />
          </Field>
          <Field label="Credenciais de teste (nomes)" help="Os valores ficam no cofre do projeto, nunca aqui.">
            <input
              className={`${inputStyle} font-mono`}
              defaultValue={programming.browser.credentials.join(', ')}
              onBlur={(event) => update({ browser: { ...programming.browser, credentials: list(event.target.value) } })}
            />
          </Field>
          <SwitchField
            label="Documentação pública"
            description="Consulta a sites públicos em sessão separada dos testes."
            checked={programming.browser.publicDocs}
            onChange={(event) => update({ browser: { ...programming.browser, publicDocs: event.target.checked } })}
          />
        </div>
      )}
      <div className="grid gap-4 border-t border-rule pt-4 md:grid-cols-3">
        <Field label="Instalação do GitHub App" help="ID da instalação que dá acesso aos repositórios abaixo.">
          <input
            type="number"
            min={1}
            className={inputStyle}
            value={programming.github.installationId ?? ''}
            onChange={(event) =>
              update({
                github: {
                  ...programming.github,
                  ...(event.target.value ? { installationId: Number(event.target.value) } : { installationId: undefined }),
                },
              })
            }
          />
        </Field>
        {definition.repositories.map((repository) => {
          const link = github(repository.id);
          const set = (patch: { owner?: string; name?: string; baseBranch?: string }) => {
            const next = { repositoryId: repository.id, owner: link?.owner ?? '', name: link?.name ?? '', baseBranch: link?.baseBranch ?? 'main', ...patch };
            const others = programming.github.repositories.filter((entry) => entry.repositoryId !== repository.id);
            update({ github: { ...programming.github, repositories: next.owner && next.name ? [...others, next] : others } });
          };
          return (
            <Field key={repository.id} label={`GitHub de ${repository.id}`} help="dono/repositório e branch base do draft PR.">
              <input
                className={`${inputStyle} font-mono`}
                defaultValue={link ? `${link.owner}/${link.name}@${link.baseBranch}` : ''}
                placeholder="equipe/projeto@main"
                onBlur={(event) => {
                  const match = /^([^/\s]+)\/([^@\s]+)(?:@(\S+))?$/.exec(event.target.value.trim());
                  if (!event.target.value.trim()) set({ owner: '', name: '' });
                  else if (match) set({ owner: match[1]!, name: match[2]!, baseBranch: match[3] ?? 'main' });
                }}
              />
            </Field>
          );
        })}
      </div>
      <div className="border-t border-rule pt-4">
        <p className="text-[13px] font-medium">Bots que podem publicar draft PR</p>
        <SwitchList className="-my-2">
          {bots
            .filter((bot) => definition.allowedBotIds.includes(bot.id))
            .map((bot) => (
              <SwitchField
                key={bot.id}
                label={`Publicar como ${bot.name}`}
                description="Merge e deploy nunca são automáticos."
                checked={programming.publisherBotIds.includes(bot.id)}
                onChange={(event) =>
                  update({
                    publisherBotIds: event.target.checked
                      ? [...programming.publisherBotIds, bot.id]
                      : programming.publisherBotIds.filter((id) => id !== bot.id),
                  })
                }
              />
            ))}
        </SwitchList>
      </div>
    </section>
  );
}
