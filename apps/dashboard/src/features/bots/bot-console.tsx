'use client';

import Link from 'next/link';
import { OinkoIcon } from '@/components/shared/oinko-icon';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Blank, Metric, Trail } from '@/features/projects/workspace-ui';

import { useState, useId, cloneElement, type FormEvent, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Play,
  Square,
  RotateCw,
  ArrowLeft,
  Bot,
  Terminal,
  Settings2,
  Activity,
  Cable,
} from 'lucide-react';
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
  'w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm outline-offset-2';
const buttonStyle = buttonVariants({ variant: 'outline', size: 'lg' });
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
  conversationSearch: false,
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
        <section className="grid gap-4 rounded-xl border border-rule bg-surface p-5 md:grid-cols-2">
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
        <section className="space-y-4 rounded-xl border border-rule bg-surface p-5">
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
        <section className="space-y-4 rounded-xl border border-rule bg-surface p-5">
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
        <section className="space-y-5 rounded-xl border border-rule bg-surface p-5">
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
        <section className="space-y-5 rounded-xl border border-rule bg-surface p-5">
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
            const update = (patch: { id?: string; enabled?: boolean; url?: string }) =>
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
                {mcp.transport === 'stdio' ? (
                  <Field
                    label={`Conexão local do MCP ${index + 1}`}
                    help="Gerenciada na configuração local do bot."
                  >
                    <input
                      readOnly
                      className={inputStyle}
                      value={[mcp.command, ...mcp.args].join(' ')}
                    />
                  </Field>
                ) : (
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
                )}
                {mcp.transport !== 'stdio' && (
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
                )}
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
        <details className="rounded-xl border border-rule bg-surface p-5">
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
          className="rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-surface disabled:opacity-50"
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

export function BotConsole({ botId }: { botId?: string }) {
  const queryClient = useQueryClient();
  const bots = useQuery({
    queryKey: key,
    queryFn: () => request<ListedBot[]>('/api/bots'),
    refetchInterval: 3000,
  });
  const [editing, setEditing] = useState<BotProfile | null | undefined>(),
    [feedback, setFeedback] = useState(''),
    [search, setSearch] = useState('');
  const selected = bots.data?.find((bot) => bot.id === botId);
  const action = useMutation({
    mutationFn: ({ id, operation }: { id: string; operation: 'start' | 'stop' | 'restart' }) =>
      request<BotStatus>(`/api/bots/${encodeURIComponent(id)}/${operation}`, {}),
    onSuccess: async () => {
      setFeedback('Operação concluída.');
      await queryClient.invalidateQueries({ queryKey: key });
    },
  });
  const shown = bots.data?.filter((bot) =>
    botId ? bot.id === botId : bot.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-7">
      <Trail
        items={[
          { label: 'Bots', ...(botId ? { href: '/bots' } : {}) },
          ...(botId ? [{ label: selected?.name ?? 'Carregando…' }] : []),
        ]}
      />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium tracking-widest text-primary uppercase">
            Seu time de IA
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{selected?.name ?? 'Seus bots'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {botId
              ? 'Comportamento, conexões e atividade em um só lugar.'
              : 'Configure cada assistente e acompanhe o trabalho que ele realiza.'}
          </p>
        </div>
        {botId && selected ? (
          <Button asChild>
            <Link href={`/bots/${selected.id}/telemetria`}>
              <Activity />
              Telemetria
            </Link>
          </Button>
        ) : (
          <Button onClick={() => setEditing(null)}>
            <Plus />
            Novo bot
          </Button>
        )}
      </header>
      {(action.error || bots.error) && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription>{action.error?.message || bots.error?.message}</AlertDescription>
        </Alert>
      )}
      {feedback && (
        <p role="status" className="text-sm text-ok">
          {feedback}
        </p>
      )}
      {bots.isPending && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      )}
      {!botId && bots.data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Bots" value={bots.data.length} icon={<Bot className="size-4" />} />
            <Metric
              label="Em execução"
              value={bots.data.filter((b) => b.status.state === 'running').length}
              icon={<Play className="size-4" />}
            />
            <Metric
              label="Programadores"
              value={bots.data.filter((b) => b.programming).length}
              icon={<Terminal className="size-4" />}
            />
            <Metric
              label="Conexões ativas"
              value={bots.data.reduce(
                (n, b) => n + b.status.connections.filter((c) => c.state === 'connected').length,
                0,
              )}
              icon={<Cable className="size-4" />}
            />
          </div>
          <Input
            className="max-w-sm"
            aria-label="Buscar bots"
            placeholder="Buscar bots…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </>
      )}
      {shown?.length === 0 && (
        <Blank
          icon={<Bot />}
          title={
            botId
              ? 'Bot não encontrado'
              : search
                ? 'Nenhum bot encontrado'
                : 'Crie seu primeiro bot'
          }
          description={
            botId
              ? 'Volte à lista para escolher outro bot.'
              : 'Escolha um modelo, defina as instruções e conecte seus canais.'
          }
        >
          {!botId && !search && <Button onClick={() => setEditing(null)}>Criar bot</Button>}
        </Blank>
      )}
      <div className={botId ? 'space-y-5' : 'grid gap-5 xl:grid-cols-2'}>
        {shown?.map((bot) => {
          const running = bot.status.state === 'running';
          return (
            <article key={bot.id} aria-label={bot.name}>
              <Card className="h-full gap-5 shadow-none">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Bot className="size-6" />
                      </div>
                      <div>
                        <CardTitle>
                          <Link href={`/bots/${bot.id}`} className="hover:text-primary">
                            {bot.name}
                          </Link>
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {bot.programming ? 'Programador' : 'Assistente'}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge
                      variant={running ? 'secondary' : 'outline'}
                      className={running ? 'bg-emerald-50 text-emerald-800' : ''}
                    >
                      {action.isPending && action.variables?.id === bot.id
                        ? 'Atualizando…'
                        : running
                          ? 'Em execução'
                          : bot.status.state === 'stopped'
                            ? 'Parado'
                            : 'Sem resposta'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{bot.model}</Badge>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="secondary">
                          {bot.telemetry.enabled ? 'Telemetria ativa' : 'Telemetria desativada'}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {bot.telemetry.enabled
                          ? `Retenção de ${bot.telemetry.retentionDays} dias`
                          : 'Ative na configuração para registrar respostas.'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <p
                    className={
                      botId
                        ? 'whitespace-pre-wrap text-sm leading-6 text-muted-foreground'
                        : 'line-clamp-3 text-sm leading-6 text-muted-foreground'
                    }
                  >
                    {bot.systemPrompt}
                  </p>
                  <Separator />
                  <div className="grid gap-4 sm:grid-cols-2">
                    {(['channel', 'mcp'] as const).map((kind) => (
                      <section key={kind} aria-label={kind === 'channel' ? 'Canais' : 'MCPs'}>
                        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                          {kind === 'channel' ? 'Canais' : 'MCPs'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {bot.status.connections.some((connection) => connection.kind === kind) ? (
                            bot.status.connections
                              .filter((connection) => connection.kind === kind)
                              .map((connection) => (
                                <Badge
                                  variant="outline"
                                  key={`${connection.kind}-${connection.id}`}
                                  className={
                                    connection.state === 'error'
                                      ? 'text-destructive'
                                      : connection.state === 'connected'
                                        ? 'text-ok'
                                        : ''
                                  }
                                >
                                  {connection.kind === 'mcp' && connection.id === 'oinko' ? (
                                    <OinkoIcon />
                                  ) : (
                                    <span className="size-1.5 rounded-full bg-current" />
                                  )}
                                  {connection.type === 'cli' ? 'CLI' : connection.id} ·{' '}
                                  {connection.state === 'connected'
                                    ? 'conectado'
                                    : connection.state === 'error'
                                      ? 'falha na conexão'
                                      : 'conectando'}
                                </Badge>
                              ))
                          ) : (
                            <span className="text-sm text-muted-foreground">
                              {[
                                kind === 'channel' && bot.cli && 'CLI',
                                kind === 'channel' && bot.telegram.enabled && 'Telegram',
                                kind === 'mcp' && bot.higgsfield && 'Higgsfield',
                                ...bot.mcps
                                  .filter((m) => kind === 'mcp' && m.enabled)
                                  .map((m) => m.id),
                              ]
                                .filter(Boolean)
                                .join(' · ') || (kind === 'channel' ? 'Sem canais' : 'Sem MCPs')}
                            </span>
                          )}
                        </div>
                      </section>
                    ))}
                  </div>
                  {(bot.status.needsRestart || !bot.hasApiKey) && (
                    <Alert>
                      <AlertDescription>
                        {!bot.hasApiKey
                          ? 'Configure a chave da API antes de iniciar.'
                          : 'Há alterações salvas. Reinicie para aplicá-las.'}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
                <CardFooter className="mt-auto flex-wrap gap-2 border-t pt-4">
                  <Button variant="outline" onClick={() => setEditing(bot)}>
                    <Settings2 />
                    Configurar
                  </Button>
                  {running ? (
                    <>
                      <Button
                        variant="ghost"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ id: bot.id, operation: 'restart' })}
                      >
                        <RotateCw />
                        Reiniciar
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={action.isPending}
                        onClick={() => action.mutate({ id: bot.id, operation: 'stop' })}
                      >
                        <Square />
                        Parar
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={
                        action.isPending || !bot.hasApiKey || bot.status.state === 'unavailable'
                      }
                      onClick={() => action.mutate({ id: bot.id, operation: 'start' })}
                    >
                      <Play />
                      Iniciar
                    </Button>
                  )}
                  <Button asChild className="ml-auto">
                    <Link href={`/bots/${bot.id}/telemetria`}>
                      <Activity />
                      Ver telemetria
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            </article>
          );
        })}
      </div>
      <Sheet
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{editing ? `Configurar ${editing.name}` : 'Novo bot'}</SheetTitle>
            <SheetDescription>
              Defina o comportamento e escolha onde o bot vai atender.
            </SheetDescription>
          </SheetHeader>
          <div className="p-6">
            {editing !== undefined && (
              <BotEditor
                key={`${editing?.id ?? 'new'}-${editing?.revision ?? 0}`}
                profile={editing}
                onCancel={() => setEditing(undefined)}
                onSaved={(bot) => {
                  setEditing(undefined);
                  setFeedback(`${bot.name} salvo. Você já pode iniciá-lo ou reiniciá-lo.`);
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
