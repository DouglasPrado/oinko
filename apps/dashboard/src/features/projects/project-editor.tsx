'use client';
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProjectSchema, type Project, type Saved } from '@oinko/workspaces/contracts';
import {
  Field,
  inputStyle,
  buttonStyle,
  panelStyle,
  slug,
  type RunnerState,
  type RunnerCommandInput,
} from './shared';

export function ProjectEditor({
  project,
  state,
  save,
  cancel,
}: {
  project?: Saved<Project>;
  state: RunnerState;
  save: (command: RunnerCommandInput) => Promise<void>;
  cancel: () => void;
}) {
  const [definition, setDefinition] = useState<Project>(
    project ?? {
      id: '',
      name: '',
      environmentId: state.environments[0]?.id ?? '',
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
      className="space-y-5"
    >
      <h2 className="text-xl font-medium">
        {project ? `Configurar ${project.name}` : 'Novo projeto'}
      </h2>
      <fieldset disabled={busy} className="space-y-5">
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
          <Field
            label="Ambiente"
            help="A configuração pode ser reutilizada; cada projeto mantém seu próprio workspace."
          >
            <select
              className={inputStyle}
              required
              value={definition.environmentId}
              onChange={(event) => change('environmentId', event.target.value)}
            >
              <option value="">Selecione</option>
              {state.environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <section className={panelStyle}>
          <h3 className="font-medium">Repositórios</h3>
          <p className="text-sm text-ink-muted">
            Um monorepo entra como um único repositório. Adicione outros quando fizerem parte do
            mesmo trabalho.
          </p>
          {definition.repositories.map((repo, index) => (
            <div className="grid gap-3 border-t border-rule pt-4 md:grid-cols-4" key={index}>
              <Field label={`ID do repositório ${index + 1}`}>
                <input
                  className={inputStyle}
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
                    className={inputStyle}
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
                  className={inputStyle}
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
                  className={buttonStyle}
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
          <h3 className="font-medium">Bots autorizados</h3>
          <p className="text-sm text-ink-muted">
            Habilite também a opção de programação no cadastro do bot.
          </p>
          {bots.data?.map((bot) => (
            <label key={bot.id} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
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
              {bot.name}
            </label>
          ))}
        </section>
        {error && (
          <p role="alert" className="text-sm text-fault">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button className={buttonStyle} type="submit">
            {busy ? 'Salvando…' : 'Salvar projeto'}
          </button>
          <button className={buttonStyle} type="button" onClick={cancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}
