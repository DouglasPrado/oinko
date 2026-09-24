'use client';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SwitchField, SwitchList } from '@/components/shared/switch-field';
import { ProjectSchema, type Project, type Saved } from '@oinko/workspaces/contracts';
import {
  Field,
  inputStyle,
  buttonStyle,
  primaryButtonStyle,
  dangerButtonStyle,
  panelStyle,
  slug,
  type RunnerCommandInput,
} from './shared';

export function ProjectEditor({
  project,
  save,
  cancel,
}: {
  project?: Saved<Project>;
  save: (command: RunnerCommandInput) => Promise<void>;
  cancel: () => void;
}) {
  const [definition, setDefinition] = useState<Project>(
    project ?? {
      id: '',
      name: '',

      repositories: [{ id: 'app', source: '', ref: 'HEAD' }],
      allowedBotIds: [],
    },
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bots = useQuery<{ id: string; name: string }[]>({
    queryKey: ['project-bots'],
    queryFn: async () => {
      const response = await fetch('/api/bots');
      if (!response.ok) throw new Error('Bots indisponíveis.');
      return response.json() as Promise<{ id: string; name: string }[]>;
    },
  });
  const change = <K extends keyof Project>(key: K, value: Project[K]) =>
    setDefinition((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await save({
        action: 'saveProject',
        definition: ProjectSchema.parse(definition),
        revision: project?.revision ?? 0,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Confira os campos.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-label="Configuração do projeto"
      className="flex flex-1 flex-col"
    >
      <fieldset disabled={busy} className="space-y-5 px-6 py-6 disabled:opacity-60">
        <div className={`${panelStyle} grid gap-4 md:grid-cols-2`}>
          <Field label="Nome do projeto">
            <input
              className={inputStyle}
              required
              value={definition.name}
              onChange={(event) =>
                setDefinition((value) => ({
                  ...value,
                  name: event.target.value,
                  ...(!project && (!value.id || value.id === slug(value.name))
                    ? { id: slug(event.target.value) }
                    : {}),
                }))
              }
            />
          </Field>
          <Field label="Identificador do projeto">
            <input
              className={inputStyle}
              required
              disabled={!!project}
              value={definition.id}
              onChange={(event) => change('id', event.target.value)}
            />
          </Field>
        </div>
        <section className={panelStyle}>
          <h3 className="text-sm font-semibold">Repositórios</h3>
          <p className="-mt-3 text-[13px] text-ink-muted">
            Um monorepo entra como um único repositório. Adicione outros quando fizerem parte do
            mesmo trabalho.
          </p>
          {definition.repositories.map((repo, index) => (
            <div className="grid gap-3 border-t border-rule pt-4 md:grid-cols-4" key={index}>
              <Field label={`ID do repositório ${index + 1}`}>
                <input
                  className={`${inputStyle} font-mono`}
                  required
                  value={repo.id}
                  onChange={(event) =>
                    change(
                      'repositories',
                      definition.repositories.map((item, i) =>
                        i === index ? { ...item, id: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              <div className="md:col-span-2">
                <Field
                  label={`Origem Git ${index + 1}`}
                  help="URL HTTPS ou caminho absoluto de um repositório local. Será criado um clone separado."
                >
                  <input
                    className={`${inputStyle} font-mono`}
                    required
                    value={repo.source}
                    onChange={(event) =>
                      change(
                        'repositories',
                        definition.repositories.map((item, i) =>
                          i === index ? { ...item, source: event.target.value } : item,
                        ),
                      )
                    }
                    placeholder="https://github.com/equipe/projeto.git"
                  />
                </Field>
              </div>
              <Field label={`Referência inicial ${index + 1}`}>
                <input
                  className={`${inputStyle} font-mono`}
                  required
                  value={repo.ref}
                  onChange={(event) =>
                    change(
                      'repositories',
                      definition.repositories.map((item, i) =>
                        i === index ? { ...item, ref: event.target.value } : item,
                      ),
                    )
                  }
                />
              </Field>
              {definition.repositories.length > 1 && (
                <button
                  type="button"
                  className={`${dangerButtonStyle} w-fit`}
                  onClick={() =>
                    change(
                      'repositories',
                      definition.repositories.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remover repositório
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className={buttonStyle}
            onClick={() =>
              change('repositories', [
                ...definition.repositories,
                { id: '', source: '', ref: 'HEAD' },
              ])
            }
          >
            Adicionar repositório
          </button>
        </section>
        <section className={panelStyle}>
          <h3 className="text-sm font-semibold">Bots autorizados</h3>
          <p className="-mt-3 text-[13px] text-ink-muted">
            Habilite também a opção de programação no cadastro do bot.
          </p>
          {bots.data?.length === 0 && (
            <p className="text-[13px] text-ink-muted">Nenhum bot cadastrado ainda.</p>
          )}
          <SwitchList className="-my-3.5">
            {bots.data?.map((bot) => (
              <SwitchField
                key={bot.id}
                label={bot.name}
                description={<span className="font-mono text-xs">{bot.id}</span>}
                checked={definition.allowedBotIds.includes(bot.id)}
                onChange={(event) =>
                  change(
                    'allowedBotIds',
                    event.target.checked
                      ? [...definition.allowedBotIds, bot.id]
                      : definition.allowedBotIds.filter((id) => id !== bot.id),
                  )
                }
              />
            ))}
          </SwitchList>
        </section>
        {error && (
          <p role="alert" className="text-sm text-error-ink">
            {error}
          </p>
        )}
      </fieldset>
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-rule bg-paper px-6 py-3">
        <button className={primaryButtonStyle} type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar projeto'}
        </button>
        <button className={buttonStyle} type="button" onClick={cancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
