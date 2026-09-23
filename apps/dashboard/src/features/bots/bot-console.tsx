'use client';

import Link from 'next/link';

import { useState, useId, cloneElement, type FormEvent, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Square, RotateCw, ArrowLeft, Bot, Terminal, Settings2 } from 'lucide-react';
import {
  BotDefinitionSchema,
  type BotDefinition,
  type BotProfile,
  type BotSecrets,
} from '@oinko/bots/schema';
import type { BotStatus } from '@oinko/bots';

type ListedBot = BotProfile & { status: BotStatus };
const key = ['bots'];
const inputStyle =
  'w-full rounded-[2px] border border-rule bg-surface px-3 py-2 text-sm outline-offset-2';
const buttonStyle =
  'inline-flex items-center justify-center gap-2 rounded-[2px] border border-rule bg-surface px-3 py-2 text-sm hover:bg-paper disabled:cursor-wait disabled:opacity-50';
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    cache: 'no-store',
  });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error((data as { error?: string }).error || 'Não foi possível concluir a operação.');
  return data as T;
}
function Field({
  label,
  children,
  help,
}: {
  label: string;
  children: ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  help?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {cloneElement(children, { id, 'aria-describedby': help ? `${id}-help` : undefined })}
      {help && (
        <span id={`${id}-help`} className="text-xs leading-5 text-ink-muted">
          {help}
        </span>
      )}
    </div>
  );
}
const initial: BotDefinition = {
  id: '',
  name: '',
  model: '',
  systemPrompt: '',
  cli: true,
  programming: false,
  telegram: { enabled: false, allowedUserIds: [], allowAllPrivateChats: false },
  higgsfield: false,
  telemetry: { enabled: true, capture: 'full', retentionDays: 30 },
  mcps: [],
};
const slug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

function BotEditor({
  profile,
  onSaved,
  onCancel,
}: {
  profile: BotProfile | null;
  onSaved: (bot: BotProfile) => void;
  onCancel: () => void;
}) {
  const [definition, setDefinition] = useState<BotDefinition>(() =>
    profile ? BotDefinitionSchema.parse(profile) : initial,
  );
  const [secrets, setSecrets] = useState<BotSecrets>({});
  const [allowedIds, setAllowedIds] = useState(profile?.telegram.allowedUserIds.join(', ') ?? '');
  const [validation, setValidation] = useState('');
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (data: BotDefinition) =>
      request<BotProfile>('/api/bots', {
        definition: data,
        secrets,
        revision: profile?.revision ?? 0,
      }),
    onSuccess: async (data) => {
      setSecrets({});
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: key });
      onSaved(data);
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = BotDefinitionSchema.safeParse({
      ...definition,
      telegram: {
        ...definition.telegram,
        allowedUserIds: allowedIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      },
    });
    if (!parsed.success) {
      setValidation(parsed.error.issues.map((issue) => issue.message).join(' '));
      return;
    }
    setValidation('');
    setSaved(false);
    save.mutate(parsed.data);
  }
  const change = <K extends keyof BotDefinition>(field: K, value: BotDefinition[K]) =>
    setDefinition((current) => ({ ...current, [field]: value }));
  return (
    <form onSubmit={submit} className="space-y-7" aria-label="Configuração do bot">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={buttonStyle}
          onClick={onCancel}
          aria-label="Voltar para bots"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-xl font-medium">
            {profile ? `Configurar ${profile.name}` : 'Novo bot'}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Defina o comportamento e escolha onde ele vai atender.
          </p>
        </div>
      </div>
      <fieldset disabled={save.isPending} className="grid gap-7 disabled:opacity-60">
        <section className="grid gap-4 border border-rule bg-surface p-5 md:grid-cols-2">
          <Field label="Nome">
            <input
              required
              className={inputStyle}
              value={definition.name}
              onChange={(event) => {
                const name = event.target.value;
                setDefinition((value) => ({
                  ...value,
                  name,
                  ...(!profile && (value.id === slug(value.name) || !value.id)
                    ? { id: slug(name) }
                    : {}),
                }));
              }}
              placeholder="Assistente de suporte"
            />
          </Field>
          <Field
            label="Identificador"
            help="Usado para escolher o bot no terminal. Não muda depois de criado."
          >
            <input
              required
              disabled={Boolean(profile)}
              className={inputStyle}
              value={definition.id}
              onChange={(event) => change('id', event.target.value)}
              pattern="[a-zA-Z0-9_-]{1,64}"
              placeholder="suporte"
            />
          </Field>
          <div className="md:col-span-2">
            <Field
              label="Instruções"
              help="Explique o papel do bot, o que ele deve fazer e como deve responder."
            >
              <textarea
                required
                className={`${inputStyle} min-h-40 leading-6`}
                value={definition.systemPrompt}
                onChange={(event) => change('systemPrompt', event.target.value)}
                placeholder="Você ajuda clientes a entender nossos produtos…"
              />
            </Field>
          </div>
        </section>
        <section className="space-y-4 border border-rule bg-surface p-5">
          <h3 className="font-medium">Modelo</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Modelo de IA">
              <input
                required
                className={inputStyle}
                value={definition.model}
                onChange={(event) => change('model', event.target.value)}
                placeholder="ID do modelo no seu provedor"
              />
            </Field>
            <Field label="URL da API" help="Deixe em branco para usar o provedor padrão do Oinko.">
              <input
                type="url"
                className={inputStyle}
                value={definition.baseUrl ?? ''}
                onChange={(event) => change('baseUrl', event.target.value || undefined)}
                placeholder="https://…/v1"
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Chave da API"
                help={
                  profile?.hasApiKey
                    ? 'Chave configurada. Preencha somente para substituí-la.'
                    : 'Você pode salvar primeiro e configurar a chave antes de iniciar.'
                }
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputStyle}
                  value={secrets.apiKey ?? ''}
                  onChange={(event) =>
                    setSecrets((value) => ({ ...value, apiKey: event.target.value }))
                  }
                  placeholder={
                    profile?.hasApiKey ? 'Chave configurada' : 'Cole a chave do provedor'
                  }
                />
              </Field>
            </div>
          </div>
        </section>
        <section className="space-y-4 border border-rule bg-surface p-5">
          <h3 className="font-medium">Programação</h3>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={definition.programming}
              onChange={(event) => change('programming', event.target.checked)}
            />
            Trabalhar com código em ambientes Docker
          </label>
          <p className="text-xs leading-5 text-ink-muted">
            Habilita arquivos, terminal, Git e prévias. Em Projetos, escolha quais repositórios este
            bot pode acessar. Reinicie o bot para aplicar.
          </p>
        </section>
        <section className="space-y-5 border border-rule bg-surface p-5">
          <div>
            <h3 className="font-medium">Canais</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Todos os canais habilitados usam este bot. As conversas ficam separadas.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={definition.cli}
              onChange={(event) => change('cli', event.target.checked)}
            />
            Terminal (CLI)
          </label>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={definition.telegram.enabled}
              onChange={(event) =>
                change('telegram', { ...definition.telegram, enabled: event.target.checked })
              }
            />
            Telegram
          </label>
          {definition.telegram.enabled && (
            <div className="grid gap-4 border-l-2 border-rule pl-5 md:grid-cols-2">
              <Field
                label="Token do Telegram"
                help={
                  profile?.hasTelegramToken
                    ? 'Token configurado. Deixe em branco para manter.'
                    : 'Token fornecido pelo BotFather.'
                }
              >
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputStyle}
                  value={secrets.telegramToken ?? ''}
                  onChange={(event) =>
                    setSecrets((value) => ({ ...value, telegramToken: event.target.value }))
                  }
                  placeholder={
                    profile?.hasTelegramToken ? 'Token configurado' : 'Cole o token do bot'
                  }
                />
              </Field>
              <label className="flex items-center gap-3 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={definition.telegram.allowAllPrivateChats}
                  onChange={(event) =>
                    change('telegram', {
                      ...definition.telegram,
                      allowAllPrivateChats: event.target.checked,
                    })
                  }
                />
                Permitir qualquer usuário em conversas privadas
              </label>
              {!definition.telegram.allowAllPrivateChats && (
                <Field
                  label="Usuários autorizados"
                  help="IDs de usuário do Telegram separados por vírgulas. Não use telefone nem @usuário."
                >
                  <input
                    required
                    className={inputStyle}
                    value={allowedIds}
                    onChange={(event) => setAllowedIds(event.target.value)}
                    placeholder="123456789, 987654321"
                  />
                </Field>
              )}
            </div>
          )}
        </section>
        <section className="space-y-5 border border-rule bg-surface p-5">
          <div>
            <h3 className="font-medium">Integrações e MCPs</h3>
            <p className="mt-1 text-sm text-ink-muted">
              Conecte serviços que oferecem ferramentas ao bot.
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={definition.higgsfield}
              onChange={(event) => change('higgsfield', event.target.checked)}
            />
            Higgsfield — imagem e vídeo
          </label>
          {definition.higgsfield && (
            <p className="text-xs text-ink-muted">
              Usa a conta autorizada em{' '}
              <a href="/integracoes" target="_blank" rel="noreferrer" className="underline">
                Integrações
              </a>
              .
            </p>
          )}
          {definition.mcps.map((mcp, index) => {
            const update = (patch: Partial<typeof mcp>) =>
              change(
                'mcps',
                definition.mcps.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
              );
            return (
              <div key={index} className="grid gap-3 border-t border-rule pt-4 md:grid-cols-2">
                <Field label={`ID do MCP ${index + 1}`}>
                  <input
                    required
                    className={inputStyle}
                    value={mcp.id}
                    onChange={(event) => update({ id: event.target.value })}
                  />
                </Field>
                <Field label={`URL do MCP ${index + 1}`}>
                  <input
                    required
                    type="url"
                    className={inputStyle}
                    value={mcp.url}
                    onChange={(event) => update({ url: event.target.value })}
                    placeholder="https://…/mcp"
                  />
                </Field>
                <Field
                  label={`Token do MCP ${index + 1}`}
                  help={
                    profile?.mcpCredentials.includes(mcp.id)
                      ? 'Token configurado. Deixe em branco para manter.'
                      : 'Opcional, enviado como Bearer.'
                  }
                >
                  <input
                    type="password"
                    autoComplete="new-password"
                    className={inputStyle}
                    value={secrets.mcpTokens?.[mcp.id] ?? ''}
                    onChange={(event) =>
                      setSecrets((value) => ({
                        ...value,
                        mcpTokens: { ...value.mcpTokens, [mcp.id]: event.target.value },
                      }))
                    }
                  />
                </Field>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={mcp.enabled}
                      onChange={(event) => update({ enabled: event.target.checked })}
                    />
                    Habilitado
                  </label>
                  <button
                    type="button"
                    className="text-sm text-fault underline"
                    onClick={() =>
                      change(
                        'mcps',
                        definition.mcps.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remover MCP {index + 1}
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className={buttonStyle}
            onClick={() =>
              change('mcps', [
                ...definition.mcps,
                { id: `mcp-${definition.mcps.length + 1}`, url: '', enabled: true },
              ])
            }
          >
            <Plus size={15} />
            Adicionar MCP
          </button>
        </section>
        <details className="border border-rule bg-surface p-5">
          <summary className="cursor-pointer text-sm font-medium">Transcrição de áudio</summary>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Modelo de transcrição">
              <input
                className={inputStyle}
                value={definition.transcriptionModel ?? ''}
                onChange={(event) => change('transcriptionModel', event.target.value || undefined)}
                placeholder="whisper-1"
              />
            </Field>
            <Field label="URL da API de transcrição">
              <input
                type="url"
                className={inputStyle}
                value={definition.transcriptionBaseUrl ?? ''}
                onChange={(event) =>
                  change('transcriptionBaseUrl', event.target.value || undefined)
                }
              />
            </Field>
            <Field
              label="Chave da API de transcrição"
              help={
                profile?.hasTranscriptionKey
                  ? 'Chave configurada. Deixe em branco para manter.'
                  : 'Sem configuração própria, usa o provedor do modelo.'
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                className={inputStyle}
                value={secrets.transcriptionKey ?? ''}
                onChange={(event) =>
                  setSecrets((value) => ({ ...value, transcriptionKey: event.target.value }))
                }
              />
            </Field>
          </div>
        </details>
      </fieldset>
      {(validation || save.error) && (
        <p role="alert" className="text-sm text-fault">
          {validation || save.error?.message}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-ok">
          Configuração salva.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-4">
        <button
          disabled={save.isPending}
          className="rounded-[2px] bg-ink px-5 py-2.5 text-sm font-medium text-surface disabled:opacity-50"
        >
          {save.isPending ? 'Salvando…' : 'Salvar bot'}
        </button>
        <button type="button" className={buttonStyle} onClick={onCancel}>
          Voltar
        </button>
        <p className="text-xs text-ink-muted">
          Para aplicar alterações a um bot em execução, reinicie-o após salvar.
        </p>
      </div>
    </form>
  );
}

export function BotConsole() {
  const queryClient = useQueryClient();
  const bots = useQuery({
    queryKey: key,
    queryFn: () => request<ListedBot[]>('/api/bots'),
    refetchInterval: 3000,
  });
  const [editing, setEditing] = useState<BotProfile | null | undefined>(undefined);
  const [feedback, setFeedback] = useState('');
  const action = useMutation({
    mutationFn: ({ id, operation }: { id: string; operation: 'start' | 'stop' | 'restart' }) =>
      request<BotStatus>(`/api/bots/${encodeURIComponent(id)}/${operation}`, {}),
    onSuccess: async () => {
      setFeedback('Operação concluída.');
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  if (editing !== undefined)
    return (
      <BotEditor
        key={`${editing?.id ?? 'new'}-${editing?.revision ?? 0}`}
        profile={editing}
        onCancel={() => setEditing(undefined)}
        onSaved={(bot) => {
          setEditing(undefined);
          setFeedback(`${bot.name} salvo. Você já pode iniciá-lo ou reiniciá-lo.`);
        }}
      />
    );
  return (
    <>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-ink-muted">Oinko</p>
          <h1 className="text-3xl font-medium tracking-tight">Seus bots</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
            Um lugar para definir o comportamento, conectar os canais e colocar cada bot para
            funcionar.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-[2px] bg-ink px-4 py-2.5 text-sm text-surface"
          onClick={() => setEditing(null)}
        >
          <Plus size={16} />
          Novo bot
        </button>
      </header>
      {(action.error || bots.error) && (
        <p role="alert" className="mb-5 border border-fault/30 bg-surface p-3 text-sm text-fault">
          {action.error?.message || bots.error?.message}
        </p>
      )}
      {feedback && (
        <p role="status" className="mb-5 text-sm text-ok">
          {feedback}
        </p>
      )}
      {bots.isPending && <p className="text-sm text-ink-muted">Carregando bots…</p>}
      {bots.data?.length === 0 && (
        <div className="border border-dashed border-rule bg-surface px-6 py-16 text-center">
          <Bot className="mx-auto mb-4 size-9 text-ink-muted" />
          <h2 className="text-lg font-medium">Crie seu primeiro bot</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Escolha um modelo, escreva as instruções e habilite os canais.
          </p>
          <button className={`${buttonStyle} mt-5`} onClick={() => setEditing(null)}>
            Criar bot
          </button>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {bots.data?.map((bot) => {
          const running = bot.status.state === 'running';
          const pending = action.isPending && action.variables?.id === bot.id;
          return (
            <article
              key={bot.id}
              aria-label={bot.name}
              className="flex flex-col border border-rule bg-surface p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-medium">{bot.name}</h2>
                  <p className="mt-1 font-mono text-xs text-ink-muted">{bot.model}</p>
                </div>
                <span
                  className={`rounded-[2px] px-2 py-1 text-xs ${running ? 'bg-ok/10 text-ok' : 'bg-paper text-ink-muted'}`}
                >
                  {pending
                    ? 'Atualizando…'
                    : running
                      ? 'Em execução'
                      : bot.status.state === 'stopped'
                        ? 'Parado'
                        : 'Sem resposta'}
                </span>
              </div>
              <p className="my-5 line-clamp-3 text-sm leading-6 text-ink-muted">
                {bot.systemPrompt}
              </p>
              <div className="mb-5 flex flex-wrap gap-2 text-xs">
                {bot.status.connections.length ? (
                  bot.status.connections.map((connection) => (
                    <span
                      key={`${connection.kind}-${connection.id}`}
                      className={`border border-rule px-2 py-1 ${connection.state === 'error' ? 'text-fault' : connection.state === 'connected' ? 'text-ok' : 'text-ink-muted'}`}
                    >
                      {connection.type === 'cli' ? 'CLI' : connection.id} ·{' '}
                      {connection.state === 'connected'
                        ? 'conectado'
                        : connection.state === 'error'
                          ? 'falha na conexão'
                          : 'conectando'}
                    </span>
                  ))
                ) : (
                  <span className="text-ink-muted">
                    {[
                      bot.cli && 'CLI',
                      bot.telegram.enabled && 'Telegram',
                      bot.higgsfield && 'Higgsfield',
                      ...bot.mcps.filter((mcp) => mcp.enabled).map((mcp) => mcp.id),
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Nenhuma conexão habilitada'}
                  </span>
                )}
              </div>
              {bot.status.needsRestart && (
                <p className="mb-4 text-xs text-spend">
                  Há alterações salvas. Reinicie para aplicá-las.
                </p>
              )}
              {!bot.hasApiKey && (
                <p className="mb-4 text-xs text-spend">
                  Configure a chave da API antes de iniciar.
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-2 border-t border-rule pt-4">
                <button className={buttonStyle} onClick={() => setEditing(bot)}>
                  <Settings2 size={14} />
                  Configurar
                </button>
                {running ? (
                  <>
                    <button
                      disabled={action.isPending}
                      className={buttonStyle}
                      onClick={() => action.mutate({ id: bot.id, operation: 'restart' })}
                    >
                      <RotateCw size={14} />
                      Reiniciar
                    </button>
                    <button
                      disabled={action.isPending}
                      className={buttonStyle}
                      onClick={() => action.mutate({ id: bot.id, operation: 'stop' })}
                    >
                      <Square size={13} />
                      Parar
                    </button>
                  </>
                ) : (
                  <button
                    disabled={
                      action.isPending || !bot.hasApiKey || bot.status.state === 'unavailable'
                    }
                    className={buttonStyle}
                    onClick={() => action.mutate({ id: bot.id, operation: 'start' })}
                  >
                    <Play size={14} />
                    Iniciar
                  </button>
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                {bot.cli ? (
                  <span className="flex items-center gap-2">
                    <Terminal size={13} />
                    <code>pnpm bot chat {bot.id}</code>
                  </span>
                ) : null}
                <Link
                  href={`/?bot=${encodeURIComponent(bot.id)}`}
                  className="ml-auto text-time underline"
                >
                  Ver telemetria
                </Link>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
