'use client';
import { useRef, useState, type FormEvent } from 'react';
import {
  EnvironmentSchema,
  ServiceSchema,
  type Environment,
  type Service,
} from '@oinko/environments/contracts';
import type { Saved } from '@oinko/workspaces/contracts';
import {
  Field,
  inputStyle,
  buttonStyle,
  panelStyle,
  slug,
  variables,
  variableText,
  type RunnerCommandInput,
} from '@/features/projects/shared';

type Profile = Saved<Environment> & { secretNames: string[] };
export function EnvironmentEditor({
  environment,
  save,
  cancel,
}: {
  environment?: Profile;
  save: (command: RunnerCommandInput) => Promise<void>;
  cancel: () => void;
}) {
  const [definition, setDefinition] = useState<Environment>(
    () =>
      environment ?? {
        ...EnvironmentSchema.parse({ id: 'new', name: 'Novo ambiente' }),
        id: '',
        name: '',
      },
  );
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [serviceKeys, setServiceKeys] = useState(() =>
    definition.services.map((_, index) => index),
  );
  const nextServiceKey = useRef(definition.services.length);
  const [secretRows, setSecretRows] = useState(() => environment?.secretNames ?? []);
  const [newSecret, setNewSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const change = <K extends keyof Environment>(key: K, value: Environment[K]) =>
    setDefinition((current) => ({ ...current, [key]: value }));
  const serviceChange = (index: number, patch: Partial<Service>) =>
    change(
      'services',
      definition.services.map((service, i) => (i === index ? { ...service, ...patch } : service)),
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const fields = new FormData(event.currentTarget);
      const fieldText = (field: string) => {
        const value = fields.get(field);
        return typeof value === 'string' ? value : '';
      };
      const names = (field: string) =>
        fieldText(field)
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
      const services = definition.services.map((service, index) => ({
        ...service,
        secrets: names(`secrets-${index}`),
        dependsOn: definition.compose ? service.dependsOn : names(`depends-${index}`),
        environment: variables(fieldText(`env-${index}`)),
        buildEnvironment: definition.compose
          ? service.buildEnvironment
          : variables(fieldText(`build-env-${index}`)),
        volumes: definition.compose
          ? service.volumes
          : fieldText(`volumes-${index}`)
              .split('\n')
              .filter((line) => line.trim())
              .map((line) => {
                const at = line.indexOf(':');
                if (at < 1) throw new Error('Use nome:/destino para os volumes.');
                return { name: line.slice(0, at).trim(), target: line.slice(at + 1).trim() };
              }),
      }));
      await save({
        action: 'saveEnvironment',
        definition: EnvironmentSchema.parse({ ...definition, services }),
        secrets,
        revision: environment?.revision ?? 0,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Confira os campos.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      aria-label="Configuração do ambiente"
      onSubmit={(event) => void submit(event)}
      className="space-y-5"
    >
      <h2 className="text-xl font-medium">
        {environment ? `Configurar ${environment.name}` : 'Novo ambiente'}
      </h2>
      <fieldset disabled={busy} className="space-y-5">
        <section className={`${panelStyle} grid gap-4 md:grid-cols-2`}>
          <Field label="Nome do ambiente">
            <input
              className={inputStyle}
              required
              value={definition.name}
              onChange={(event) =>
                setDefinition((value) => ({
                  ...value,
                  name: event.target.value,
                  ...(!environment && (value.id === 'new' || value.id === slug(value.name))
                    ? { id: slug(event.target.value) }
                    : {}),
                }))
              }
            />
          </Field>
          <Field label="Identificador do ambiente">
            <input
              className={inputStyle}
              required
              disabled={!!environment}
              value={definition.id}
              onChange={(event) => change('id', event.target.value)}
            />
          </Field>
          <Field
            label="Imagem de programação"
            help="O padrão inclui Node, Git, Bash, Python e Corepack. Imagens próprias devem oferecer Git, Bash, Node e timeout."
          >
            <input
              className={inputStyle}
              required
              value={definition.workspaceImage}
              onChange={(event) => change('workspaceImage', event.target.value)}
            />
          </Field>
          <Field label="Rede do ambiente">
            <select
              className={inputStyle}
              value={definition.network}
              onChange={(event) => change('network', event.target.value as Environment['network'])}
            >
              <option value="internet">Permitir acesso à internet</option>
              <option value="none">Sem acesso externo</option>
            </select>
          </Field>
          <Field label="CPUs por container">
            <input
              type="number"
              min="0.25"
              max="32"
              step="0.25"
              className={inputStyle}
              value={definition.cpus}
              onChange={(event) => change('cpus', Number(event.target.value))}
            />
          </Field>
          <Field label="Memória por container (MB)">
            <input
              type="number"
              min="128"
              max="65536"
              className={inputStyle}
              value={definition.memoryMb}
              onChange={(event) => change('memoryMb', Number(event.target.value))}
            />
          </Field>
          <Field
            label="Prévias simultâneas por projeto"
            help="Com uma prévia, iniciar outra tarefa encerra a anterior e preserva seus dados."
          >
            <input
              type="number"
              min="1"
              max="8"
              className={inputStyle}
              value={definition.maxPreviews}
              onChange={(event) => change('maxPreviews', Number(event.target.value))}
            />
          </Field>
        </section>
        <section className={panelStyle}>
          <h3 className="font-medium">Receita da aplicação</h3>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={!!definition.compose}
              onChange={(event) =>
                change(
                  'compose',
                  event.target.checked ? { repositoryId: 'app', path: 'compose.yaml' } : undefined,
                )
              }
            />
            Usar Compose do repositório
          </label>
          {definition.compose && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Repositório do Compose">
                <input
                  className={inputStyle}
                  value={definition.compose.repositoryId}
                  onChange={(event) =>
                    change('compose', { ...definition.compose!, repositoryId: event.target.value })
                  }
                />
              </Field>
              <Field label="Caminho do Compose">
                <input
                  className={inputStyle}
                  value={definition.compose.path}
                  onChange={(event) =>
                    change('compose', { ...definition.compose!, path: event.target.value })
                  }
                />
              </Field>
              <p className="text-xs leading-5 text-ink-muted md:col-span-2">
                Imagens, builds e dependências vêm do Compose. Cadastre abaixo os mesmos IDs de
                serviço para configurar acesso, porta, variáveis e modo de desenvolvimento.
                Montagens externas e privilégios do host são recusados.
              </p>
            </div>
          )}
        </section>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Serviços</h3>
            <button
              className={buttonStyle}
              type="button"
              onClick={() => {
                setServiceKeys((keys) => [...keys, nextServiceKey.current++]);
                change('services', [
                  ...definition.services,
                  ServiceSchema.parse({ id: `service-${definition.services.length + 1}` }),
                ]);
              }}
            >
              Adicionar serviço
            </button>
          </div>
          {!definition.services.length && (
            <p className="text-sm text-ink-muted">
              Adicione frontend, API e dependências. Cada aplicação pode usar seu próprio método de
              build.
            </p>
          )}
          {definition.services.map((service, index) => (
            <details key={serviceKeys[index]} open className={panelStyle}>
              <summary className="cursor-pointer font-medium">
                {service.id || `Serviço ${index + 1}`}
              </summary>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={`ID do serviço ${index + 1}`}>
                  <input
                    className={inputStyle}
                    required
                    value={service.id}
                    onChange={(event) => serviceChange(index, { id: event.target.value })}
                  />
                </Field>
                {!definition.compose && (
                  <Field label={`Método de build ${index + 1}`}>
                    <select
                      className={inputStyle}
                      value={service.builder}
                      onChange={(event) =>
                        serviceChange(index, {
                          builder: event.target.value as Service['builder'],
                          ...(event.target.value !== 'image' && !service.repositoryId
                            ? { repositoryId: 'app' }
                            : {}),
                        })
                      }
                    >
                      <option value="image">Imagem pronta</option>
                      <option value="dockerfile">Dockerfile</option>
                      <option value="railpack">Railpack (automático)</option>
                    </select>
                  </Field>
                )}
                <Field label={`Modo de teste ${index + 1}`}>
                  <select
                    className={inputStyle}
                    value={service.mode}
                    onChange={(event) =>
                      serviceChange(index, {
                        mode: event.target.value as Service['mode'],
                        ...(event.target.value === 'development' && !service.repositoryId
                          ? { repositoryId: 'app' }
                          : {}),
                      })
                    }
                  >
                    <option value="image">Prévia compilada</option>
                    <option value="development">Desenvolvimento com código montado</option>
                  </select>
                </Field>
                {!definition.compose && service.builder === 'image' && (
                  <Field label={`Imagem Docker ${index + 1}`}>
                    <input
                      className={inputStyle}
                      required
                      value={service.image}
                      onChange={(event) => serviceChange(index, { image: event.target.value })}
                    />
                  </Field>
                )}
                {!definition.compose &&
                  (service.builder !== 'image' || service.mode === 'development') && (
                    <>
                      <Field label={`Repositório do serviço ${index + 1}`}>
                        <input
                          className={inputStyle}
                          required
                          value={service.repositoryId ?? ''}
                          onChange={(event) =>
                            serviceChange(index, { repositoryId: event.target.value })
                          }
                        />
                      </Field>
                      <Field
                        label={`Contexto de build ${index + 1}`}
                        help="Use . para preservar os pacotes compartilhados de um monorepo."
                      >
                        <input
                          className={inputStyle}
                          value={service.context}
                          onChange={(event) =>
                            serviceChange(index, { context: event.target.value })
                          }
                        />
                      </Field>
                    </>
                  )}
                {!definition.compose && service.builder === 'dockerfile' && (
                  <Field
                    label={`Dockerfile ${index + 1}`}
                    help="Caminho relativo ao contexto de build."
                  >
                    <input
                      className={inputStyle}
                      value={service.dockerfile}
                      onChange={(event) => serviceChange(index, { dockerfile: event.target.value })}
                    />
                  </Field>
                )}
                {!definition.compose && service.builder === 'railpack' && (
                  <Field
                    label={`Comando de build ${index + 1}`}
                    help="Vazio usa a detecção automática."
                  >
                    <input
                      className={inputStyle}
                      value={service.buildCommand}
                      onChange={(event) =>
                        serviceChange(index, { buildCommand: event.target.value })
                      }
                    />
                  </Field>
                )}
                {!definition.compose && (
                  <Field
                    label={`Comando de início ${index + 1}`}
                    help="Vazio usa o comando da imagem. Para desenvolvimento, use um servidor que escute em 0.0.0.0."
                  >
                    <input
                      className={inputStyle}
                      value={service.command}
                      onChange={(event) => serviceChange(index, { command: event.target.value })}
                      placeholder="pnpm install && pnpm dev --host 0.0.0.0"
                    />
                  </Field>
                )}
                {service.mode === 'development' && (
                  <Field label={`Pasta de execução ${index + 1}`}>
                    <input
                      className={inputStyle}
                      value={service.workdir}
                      onChange={(event) => serviceChange(index, { workdir: event.target.value })}
                    />
                  </Field>
                )}
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={service.expose}
                    onChange={(event) => serviceChange(index, { expose: event.target.checked })}
                  />
                  Disponibilizar serviço {index + 1} no navegador
                </label>
                {service.expose && (
                  <>
                    <Field label={`Porta interna ${index + 1}`}>
                      <input
                        type="number"
                        min="1"
                        max="65535"
                        className={inputStyle}
                        value={service.port}
                        onChange={(event) =>
                          serviceChange(index, { port: Number(event.target.value) })
                        }
                      />
                    </Field>
                    <Field label={`Verificação de disponibilidade ${index + 1}`}>
                      <input
                        className={inputStyle}
                        value={service.healthPath}
                        onChange={(event) =>
                          serviceChange(index, { healthPath: event.target.value })
                        }
                      />
                    </Field>
                  </>
                )}
                <Field
                  label={`Variáveis do serviço ${index + 1}`}
                  help="KEY=VALUE, uma por linha. Use os campos de segredos para credenciais."
                >
                  <textarea
                    className={inputStyle}
                    name={`env-${index}`}
                    rows={3}
                    defaultValue={variableText(service.environment)}
                  />
                </Field>
                {!definition.compose && (
                  <Field
                    label={`Variáveis públicas de build ${index + 1}`}
                    help="Valores usados para construir a imagem. Não coloque senhas aqui."
                  >
                    <textarea
                      className={inputStyle}
                      name={`build-env-${index}`}
                      rows={3}
                      defaultValue={variableText(service.buildEnvironment)}
                    />
                  </Field>
                )}
                <Field
                  label={`Segredos usados ${index + 1}`}
                  help="Nomes separados por vírgula. Cadastre os valores abaixo."
                >
                  <input
                    className={inputStyle}
                    name={`secrets-${index}`}
                    defaultValue={service.secrets.join(', ')}
                  />
                </Field>
                {!definition.compose && (
                  <Field
                    label={`Dependências ${index + 1}`}
                    help="IDs de serviços separados por vírgula."
                  >
                    <input
                      className={inputStyle}
                      name={`depends-${index}`}
                      defaultValue={service.dependsOn.join(', ')}
                    />
                  </Field>
                )}
                {!definition.compose && (
                  <Field
                    label={`Volumes persistentes ${index + 1}`}
                    help="Um nome:/destino por linha. Os dados ficam separados por prévia."
                  >
                    <textarea
                      className={inputStyle}
                      name={`volumes-${index}`}
                      rows={2}
                      defaultValue={service.volumes
                        .map((volume) => `${volume.name}:${volume.target}`)
                        .join('\n')}
                    />
                  </Field>
                )}
              </div>
              <button
                type="button"
                className={buttonStyle}
                onClick={() => {
                  setServiceKeys((keys) => keys.filter((_, i) => i !== index));
                  change(
                    'services',
                    definition.services.filter((_, i) => i !== index),
                  );
                }}
              >
                Remover serviço {index + 1}
              </button>
            </details>
          ))}
        </section>
        <section className={panelStyle}>
          <h3 className="font-medium">Segredos do ambiente</h3>
          <p className="text-xs leading-5 text-ink-muted">
            Os valores são cifrados. Deixe em branco para manter o valor salvo. Só os serviços
            selecionados recebem cada segredo.
          </p>
          {secretRows.map((name) => (
            <div key={name} className="flex items-end gap-3">
              <div className="flex-1">
                <Field label={name}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={inputStyle}
                    placeholder={
                      environment?.secretNames.includes(name) ? 'Valor configurado' : 'Novo valor'
                    }
                    value={secrets[name] ?? ''}
                    onChange={(event) =>
                      setSecrets((current) => {
                        const next = { ...current };
                        if (event.target.value) next[name] = event.target.value;
                        else delete next[name];
                        return next;
                      })
                    }
                  />
                </Field>
              </div>
              <button
                type="button"
                className={buttonStyle}
                onClick={() => {
                  setSecretRows((current) => current.filter((key) => key !== name));
                  setSecrets((current) => ({ ...current, [name]: '' }));
                }}
              >
                Remover
              </button>
            </div>
          ))}
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Field label="Nome do novo segredo">
                <input
                  className={inputStyle}
                  value={newSecret}
                  onChange={(event) => setNewSecret(event.target.value)}
                  placeholder="DATABASE_PASSWORD"
                />
              </Field>
            </div>
            <button
              type="button"
              className={buttonStyle}
              onClick={() => {
                if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(newSecret) && !secretRows.includes(newSecret)) {
                  setSecretRows((rows) => [...rows, newSecret]);
                  setNewSecret('');
                }
              }}
            >
              Adicionar segredo
            </button>
          </div>
        </section>
        {error && (
          <p role="alert" className="text-sm text-fault whitespace-pre-wrap">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button className={buttonStyle} type="submit">
            {busy ? 'Salvando…' : 'Salvar ambiente'}
          </button>
          <button className={buttonStyle} type="button" onClick={cancel}>
            Cancelar
          </button>
        </div>
      </fieldset>
    </form>
  );
}
