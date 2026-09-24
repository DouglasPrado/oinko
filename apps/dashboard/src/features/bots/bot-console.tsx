'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
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
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { PageHeader } from '@/components/shared/page-header';
import { SearchField } from '@/components/shared/search-field';
import { StatusDot, type StatusTone } from '@/components/shared/status-dot';
import { Blank, Metric, MetricGrid, listStyle } from '@/features/projects/workspace-ui';
import { Field, inputStyle, textareaStyle } from '@/features/projects/shared';
import { SwitchField, SwitchList } from '@/components/shared/switch-field';
import { ChannelIcon } from '@/components/shared/channel-icons';
import { OinkoIcon } from '@/components/shared/oinko-icon';
import { cn } from '@/lib/utils/cn';
import { ContextSettings } from './context-settings';
import { ProgrammingSettings } from './programming-settings';

import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Play,
  Square,
  RotateCw,
  Bot,
  Terminal,
  Settings2,
  Activity,
  Cable,
  TriangleAlert,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import {
  BotDefinitionSchema,
  type BotDefinition,
  type BotProfile,
  type BotSecrets,
} from '@oinko/bots/schema';
import type { BotStatus } from '@oinko/bots';

type ListedBot = BotProfile & { status: BotStatus };
type Operation = 'start' | 'stop' | 'restart';
const DONE: Record<Operation, string> = {
  start: 'iniciado',
  stop: 'parado',
  restart: 'reiniciado',
};
const FAILED: Record<Operation, string> = {
  start: 'Não foi possível iniciar o bot',
  stop: 'Não foi possível parar o bot',
  restart: 'Não foi possível reiniciar o bot',
};
const key = ['bots'];
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

/** Secao do formulario: titulo e apoio no topo, campos abaixo de uma hairline. */
function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className="rounded-xl border border-rule">
      <header className="border-b border-rule px-5 py-3.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
      </header>
      <div className={className ?? 'space-y-4 p-5'}>{children}</div>
    </section>
  );
}

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
      await queryClient.invalidateQueries({ queryKey: key });
      onSaved(data);
    },
    onError: (error) => toast.error('Não foi possível salvar o bot', error.message),
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
      const message = parsed.error.issues.map((issue) => issue.message).join(' ');
      setValidation(message);
      toast.error('Confira os campos do bot', message);
      return;
    }
    setValidation('');
    save.mutate(parsed.data);
  }
  const change = <K extends keyof BotDefinition>(field: K, value: BotDefinition[K]) =>
    setDefinition((current) => ({ ...current, [field]: value }));
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col" aria-label="Configuração do bot">
      <fieldset disabled={save.isPending} className="space-y-5 px-6 py-6 disabled:opacity-60">
        <FormSection title="Identidade" className="grid items-start gap-4 p-5 md:grid-cols-2">
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
              className={cn(inputStyle, 'font-mono')}
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
                className={cn(textareaStyle, 'min-h-40')}
                value={definition.systemPrompt}
                onChange={(event) => change('systemPrompt', event.target.value)}
                placeholder="Você ajuda clientes a entender nossos produtos…"
              />
            </Field>
          </div>
        </FormSection>
        <FormSection title="Modelo" className="grid items-start gap-4 p-5 md:grid-cols-2">
          <Field label="Modelo de IA">
            <input
              required
              className={cn(inputStyle, 'font-mono')}
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
                placeholder={profile?.hasApiKey ? 'Chave configurada' : 'Cole a chave do provedor'}
              />
            </Field>
          </div>
        </FormSection>
        <ContextSettings
          definition={definition}
          onChange={(changes) => setDefinition((value) => ({ ...value, ...changes }))}
          secrets={secrets}
          onSecrets={(changes) => setSecrets((value) => ({ ...value, ...changes }))}
          hasTypesafeKey={profile?.hasTypesafeKey ?? false}
        />
        <FormSection title="Programação" className="space-y-4 px-5 pb-5">
          <SwitchField
            label="Trabalhar com código em ambientes Docker"
            description="Habilita arquivos, terminal, Git e prévias. Em Projetos, escolha quais repositórios este bot pode acessar. Reinicie o bot para aplicar."
            checked={definition.programming}
            onChange={(event) => change('programming', event.target.checked)}
          />
          <ProgrammingSettings
            definition={definition}
            onChange={(changes) => setDefinition((value) => ({ ...value, ...changes }))}
            {...(profile && { botId: profile.id })}
          />
        </FormSection>
        <FormSection
          title="Canais"
          description="Todos os canais habilitados usam este bot. As conversas ficam separadas."
          className="px-5"
        >
          <SwitchList>
            <SwitchField
              label="Terminal (CLI)"
              description="Converse com o bot pelo terminal deste computador."
              checked={definition.cli}
              onChange={(event) => change('cli', event.target.checked)}
            />
            <SwitchField
              label="Telegram"
              description="Atenda pelo bot do Telegram criado no BotFather."
              checked={definition.telegram.enabled}
              onChange={(event) =>
                change('telegram', { ...definition.telegram, enabled: event.target.checked })
              }
            >
              {definition.telegram.enabled && (
                <div className="space-y-4 rounded-lg border border-rule bg-paper p-4">
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
                  <SwitchField
                    className="border-t border-rule pb-0"
                    label="Permitir qualquer usuário em conversas privadas"
                    description="Desligado, só os usuários autorizados abaixo conversam com o bot."
                    checked={definition.telegram.allowAllPrivateChats}
                    onChange={(event) =>
                      change('telegram', {
                        ...definition.telegram,
                        allowAllPrivateChats: event.target.checked,
                      })
                    }
                  />
                  {!definition.telegram.allowAllPrivateChats && (
                    <Field
                      label="Usuários autorizados"
                      help="IDs de usuário do Telegram separados por vírgulas. Não use telefone nem @usuário."
                    >
                      <input
                        required
                        className={cn(inputStyle, 'font-mono')}
                        value={allowedIds}
                        onChange={(event) => setAllowedIds(event.target.value)}
                        placeholder="123456789, 987654321"
                      />
                    </Field>
                  )}
                </div>
              )}
            </SwitchField>
          </SwitchList>
        </FormSection>
        <FormSection
          title="Integrações e MCPs"
          description="Conecte serviços que oferecem ferramentas ao bot."
          className="space-y-4 px-5 pb-5"
        >
          <SwitchField
            label="Higgsfield — imagem e vídeo"
            description={
              <>
                Usa a conta autorizada em{' '}
                <a
                  href="/integracoes"
                  target="_blank"
                  rel="noreferrer"
                  className="text-info-ink underline-offset-4 hover:underline"
                >
                  Integrações
                </a>
                .
              </>
            }
            checked={definition.higgsfield}
            onChange={(event) => change('higgsfield', event.target.checked)}
          />
          {definition.mcps.map((mcp, index) => {
            const update = (patch: { id?: string; enabled?: boolean; url?: string }) =>
              change(
                'mcps',
                definition.mcps.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
              );
            return (
              <div key={index} className="overflow-hidden rounded-lg border border-rule">
                <div className="flex h-11 items-center justify-between gap-3 border-b border-rule bg-paper px-4">
                  <span className="font-mono text-xs text-ink-muted">MCP {index + 1}</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    onClick={() =>
                      change(
                        'mcps',
                        definition.mcps.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 aria-hidden />
                    Remover MCP {index + 1}
                  </Button>
                </div>
                <div className="grid items-start gap-4 p-4 md:grid-cols-2">
                  <Field label={`ID do MCP ${index + 1}`}>
                    <input
                      required
                      className={cn(inputStyle, 'font-mono')}
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
                    <div className="md:col-span-2">
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
                    </div>
                  )}
                </div>
                <SwitchField
                  className="border-t border-rule px-4"
                  label="Habilitado"
                  description="Desligado, a configuração fica salva, mas o bot não conecta."
                  checked={mcp.enabled}
                  onChange={(event) => update({ enabled: event.target.checked })}
                />
              </div>
            );
          })}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              change('mcps', [
                ...definition.mcps,
                { id: `mcp-${definition.mcps.length + 1}`, url: '', enabled: true },
              ])
            }
          >
            <Plus aria-hidden />
            Adicionar MCP
          </Button>
        </FormSection>
        <details className="group rounded-xl border border-rule">
          <summary className="flex h-12 items-center px-5 text-sm font-semibold marker:content-none group-open:border-b group-open:border-rule">
            Transcrição de áudio
            <span className="ml-auto text-xs font-normal text-ink-muted">Opcional</span>
            <ChevronDown
              className="ml-2 size-4 text-ink-muted transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="grid items-start gap-4 p-5 md:grid-cols-2">
            <Field label="Modelo de transcrição">
              <input
                className={cn(inputStyle, 'font-mono')}
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
        {(validation || save.error) && (
          <p role="alert" className="text-sm text-error-ink">
            {validation || save.error?.message}
          </p>
        )}
      </fieldset>
      <div className="sticky bottom-0 mt-auto flex flex-wrap items-center gap-2 border-t border-rule bg-paper px-6 py-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar bot'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Voltar
        </Button>
        <p className="basis-full text-xs text-ink-muted sm:ml-auto sm:basis-auto">
          Para aplicar alterações a um bot em execução, reinicie-o após salvar.
        </p>
      </div>
    </form>
  );
}

function botState(bot: ListedBot, pending: boolean): { tone: StatusTone; label: string } {
  if (pending) return { tone: 'warning', label: 'Atualizando…' };
  if (bot.status.state === 'running') return { tone: 'ready', label: 'Em execução' };
  if (bot.status.state === 'stopped') return { tone: 'neutral', label: 'Parado' };
  return { tone: 'error', label: 'Sem resposta' };
}

const CONNECTION: Record<BotStatus['connections'][number]['state'], [StatusTone, string]> = {
  connected: ['ready', 'conectado'],
  error: ['error', 'falha na conexão'],
  connecting: ['warning', 'conectando'],
};

type ChannelState = BotStatus['connections'][number]['state'] | 'offline';

interface ChannelView {
  key: string;
  kind: 'channel' | 'mcp';
  type: string;
  label: string;
  state: ChannelState;
  error?: string | undefined;
}

/**
 * Conexoes vivas quando o bot roda; sem elas, os canais que ele vai abrir ao
 * iniciar, marcados como fora do ar.
 */
function channelsOf(bot: ListedBot): ChannelView[] {
  if (bot.status.connections.length)
    return bot.status.connections.map((connection) => ({
      key: `${connection.kind}-${connection.id}`,
      kind: connection.kind,
      type: connection.type,
      label:
        connection.type === 'cli'
          ? 'CLI'
          : connection.type === 'telegram'
            ? 'Telegram'
            : connection.type === 'higgsfield'
              ? 'Higgsfield'
              : connection.id,
      state: connection.state,
      error: connection.error,
    }));
  return [
    ...(bot.cli ? [{ key: 'channel-local', type: 'cli', label: 'CLI' }] : []),
    ...(bot.telegram.enabled
      ? [{ key: 'channel-telegram', type: 'telegram', label: 'Telegram' }]
      : []),
    ...(bot.higgsfield ? [{ key: 'mcp-higgsfield', type: 'higgsfield', label: 'Higgsfield' }] : []),
    ...bot.mcps
      .filter((m) => m.enabled)
      .map((m) => ({ key: `mcp-${m.id}`, type: 'mcp', label: m.id })),
  ].map((channel) => ({
    ...channel,
    kind:
      channel.type === 'mcp' || channel.type === 'higgsfield'
        ? ('mcp' as const)
        : ('channel' as const),
    state: 'offline' as const,
  }));
}

function stateText(state: ChannelState): string {
  return state === 'offline' ? 'bot parado' : CONNECTION[state][1];
}

/** Detalhe do bot: cada canal com icone e estado por extenso. */
function Connections({ bot }: { bot: ListedBot }) {
  const channels = channelsOf(bot);
  if (!channels.length)
    return <span className="text-[13px] text-ink-muted">Nenhuma conexão habilitada</span>;
  return (
    <>
      {channels.map((channel) => (
        <Badge
          key={channel.key}
          variant={channel.state === 'error' ? 'destructive' : 'neutral'}
          title={channel.error}
        >
          <span className="flex">
            {channel.key === 'mcp-oinko' ? (
              <OinkoIcon
                className={cn('size-3.5', channel.state === 'offline' && 'opacity-50 grayscale')}
              />
            ) : (
              <ChannelIcon
                type={channel.type}
                className={cn('size-3.5', channel.state === 'offline' && 'opacity-50 grayscale')}
              />
            )}
          </span>
          {channel.label} · {stateText(channel.state)}
        </Badge>
      ))}
    </>
  );
}

/**
 * Canais da linha so como icone colorido: cheio quando conectado, com ponto
 * quando conectando ou em falha, apagado e sem cor quando o bot esta parado.
 *
 * O nome e o estado seguem em texto para leitor de tela e na dica do mouse; o
 * icone sozinho nao diria qual canal falhou.
 */
function ChannelIcons({ bot, kind }: { bot: ListedBot; kind: 'channel' | 'mcp' }) {
  const channels = channelsOf(bot).filter((connection) => connection.kind === kind);
  const label = kind === 'channel' ? 'Canais' : 'MCPs';
  if (!channels.length)
    return (
      <span className="text-[13px] text-ink-muted">
        {kind === 'channel' ? 'Sem canais' : 'Sem MCPs'}
      </span>
    );
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label={label}>
      {channels.map((channel) => {
        const text = `${channel.label} · ${stateText(channel.state)}`;
        return (
          <li key={channel.key}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="relative flex size-7 items-center justify-center rounded-md transition-colors hover:bg-hover">
                  {channel.key === 'mcp-oinko' ? (
                    <OinkoIcon
                      className={cn(
                        'size-5',
                        channel.state === 'offline' && 'opacity-35 grayscale',
                      )}
                    />
                  ) : (
                    <ChannelIcon
                      type={channel.type}
                      className={cn(
                        'size-5',
                        channel.state === 'offline' && 'opacity-35 grayscale',
                      )}
                    />
                  )}
                  {(channel.state === 'connecting' || channel.state === 'error') && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-0 right-0 size-2.5 rounded-full ring-2 ring-canvas',
                        channel.state === 'error' ? 'bg-error' : 'animate-pulse bg-warning',
                      )}
                    />
                  )}
                  <span className="sr-only">{text}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {text}
                {channel.error ? ` — ${channel.error}` : ''}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

function IconAction({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface Controls {
  bot: ListedBot;
  busy: boolean;
  run: (operation: Operation) => void;
  edit: () => void;
}

/** Ligar, parar e configurar. Na linha vira icone com dica; no detalhe, botao com rotulo. */
function BotControls({ bot, busy, run, edit, compact }: Controls & { compact?: boolean }) {
  const running = bot.status.state === 'running';
  const canStart = !busy && bot.hasApiKey && bot.status.state !== 'unavailable';
  if (compact)
    return (
      <div className="flex items-center gap-0.5">
        {running ? (
          <>
            <IconAction label="Reiniciar" disabled={busy} onClick={() => run('restart')}>
              <RotateCw aria-hidden />
            </IconAction>
            <IconAction label="Parar" disabled={busy} onClick={() => run('stop')}>
              <Square aria-hidden />
            </IconAction>
          </>
        ) : (
          <IconAction label="Iniciar" disabled={!canStart} onClick={() => run('start')}>
            <Play aria-hidden />
          </IconAction>
        )}
        <IconAction label="Configurar" onClick={edit}>
          <Settings2 aria-hidden />
        </IconAction>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" asChild>
              <Link href={`/bots/${bot.id}/telemetria`} aria-label="Ver telemetria">
                <Activity aria-hidden />
              </Link>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Ver telemetria</TooltipContent>
        </Tooltip>
      </div>
    );
  return (
    <>
      <Button variant="outline" onClick={edit}>
        <Settings2 aria-hidden />
        Configurar
      </Button>
      {running ? (
        <>
          <Button variant="outline" disabled={busy} onClick={() => run('restart')}>
            <RotateCw aria-hidden />
            Reiniciar
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => run('stop')}>
            <Square aria-hidden />
            Parar
          </Button>
        </>
      ) : (
        <Button variant="outline" disabled={!canStart} onClick={() => run('start')}>
          <Play aria-hidden />
          Iniciar
        </Button>
      )}
      <Button asChild>
        <Link href={`/bots/${bot.id}/telemetria`}>
          <Activity aria-hidden />
          Ver telemetria
        </Link>
      </Button>
    </>
  );
}

function BotAvatar({ bot }: { bot: ListedBot }) {
  const Icon = bot.programming ? Terminal : Bot;
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-rule bg-canvas text-ink-muted">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

function Notice({ bot, className }: { bot: ListedBot; className?: string }) {
  if (!bot.status.needsRestart && bot.hasApiKey) return null;
  return (
    <p className={cn('flex items-center gap-2 text-[13px] text-ink', className)}>
      <TriangleAlert className="size-4 shrink-0 text-warning-ink" aria-hidden />
      {!bot.hasApiKey
        ? 'Configure a chave da API antes de iniciar.'
        : 'Há alterações salvas. Reinicie para aplicá-las.'}
    </p>
  );
}

/*
 * Grade compartilhada pelas linhas e pelo cabecalho. Cada linha e uma grade
 * propria, entao nenhuma coluna pode depender do conteudo: a de acoes tem a
 * largura de quatro botoes (bot rodando), e um bot parado, com tres, nao
 * desloca Estado, Canais e MCPs.
 */
const ROW_GRID =
  'sm:grid-cols-[minmax(0,1fr)_8.5rem] xl:grid-cols-[minmax(0,1fr)_11rem_7rem_7rem_8.5rem] xl:gap-x-6';

/**
 * Um bot por linha, na mesma grade: identidade absorve a largura, estado e
 * canais ficam em colunas fixas. Abaixo de xl, a linha empilha em duas.
 */
function BotRow(props: Controls & { pending: boolean }) {
  const { bot, pending } = props;
  const state = botState(bot, pending);
  return (
    <article
      aria-label={bot.name}
      className={cn(
        'grid grid-cols-1 items-center gap-x-4 gap-y-2.5 px-4 py-3 transition-colors hover:bg-paper',
        ROW_GRID,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <BotAvatar bot={bot} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={`/bots/${bot.id}`}
              className="truncate font-medium text-ink underline-offset-4 hover:underline"
            >
              {bot.name}
            </Link>
            <span className="shrink-0 text-xs text-ink-muted">
              {bot.programming ? 'Programador' : 'Assistente'}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[13px] text-ink-muted">{bot.systemPrompt}</p>
        </div>
      </div>
      {/* Abaixo de sm as acoes descem para o fim, e o nome fica com a linha inteira. */}
      <div className="flex max-sm:order-last max-sm:-ml-2 max-sm:pl-11 sm:justify-end xl:order-last">
        <BotControls {...props} compact />
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 pl-11 sm:col-span-2 xl:contents">
        <div className="flex min-w-0 items-center gap-x-4 xl:block">
          <StatusDot tone={state.tone} label={state.label} pulse={pending} />
          <span
            className="block truncate font-mono text-xs text-ink-muted xl:mt-1"
            title={bot.model}
          >
            {bot.model}
          </span>
        </div>
        {(['channel', 'mcp'] as const).map((kind) => (
          <div key={kind} className="min-w-0">
            <span className="mb-1 block text-xs text-ink-muted xl:hidden">
              {kind === 'channel' ? 'Canais' : 'MCPs'}
            </span>
            <ChannelIcons bot={bot} kind={kind} />
          </div>
        ))}
      </div>
      <Notice bot={bot} className="col-span-full pl-11 xl:order-last" />
    </article>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 px-4 py-2">
      <dt className="shrink-0 text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[13px] text-ink">{children}</dd>
    </div>
  );
}

/** Pagina de um bot: as instrucoes sao a peca principal; o resto e ficha tecnica. */
function BotOverview({ bot, pending }: { bot: ListedBot; pending: boolean }) {
  const state = botState(bot, pending);
  return (
    <article aria-label={bot.name} className="space-y-5">
      {(bot.status.needsRestart || !bot.hasApiKey) && (
        <Alert variant="warning">
          <TriangleAlert aria-hidden />
          <AlertDescription className="text-ink!">
            {!bot.hasApiKey
              ? 'Configure a chave da API antes de iniciar.'
              : 'Há alterações salvas. Reinicie para aplicá-las.'}
          </AlertDescription>
        </Alert>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <section className="rounded-xl border border-rule">
          <header className="flex h-11 items-center border-b border-rule px-4">
            <h2 className="text-sm font-semibold">Instruções</h2>
          </header>
          <p className="max-w-[80ch] px-4 py-4 text-sm leading-6 whitespace-pre-wrap text-ink">
            {bot.systemPrompt}
          </p>
        </section>
        <div className="space-y-5">
          <section className="rounded-xl border border-rule">
            <header className="flex h-11 items-center border-b border-rule px-4">
              <h2 className="text-sm font-semibold">Detalhes</h2>
            </header>
            <dl className="divide-y divide-rule">
              <Detail label="Estado">
                <StatusDot
                  tone={state.tone}
                  label={state.label}
                  pulse={pending}
                  className="text-[13px]!"
                />
              </Detail>
              <Detail label="Tipo">{bot.programming ? 'Programador' : 'Assistente'}</Detail>
              <Detail label="Modelo">
                <span className="block truncate font-mono text-xs" title={bot.model}>
                  {bot.model}
                </span>
              </Detail>
              <Detail label="Chave da API">
                {bot.hasApiKey ? 'Configurada' : 'Não configurada'}
              </Detail>
              <Detail label="Telemetria">
                {bot.telemetry.enabled
                  ? `Ativa · ${bot.telemetry.retentionDays} dias`
                  : 'Desativada'}
              </Detail>
              <Detail label="Trabalhos">
                <Link
                  href={`/bots/${encodeURIComponent(bot.id)}/trabalhos`}
                  className="text-info-ink underline-offset-4 hover:underline"
                >
                  {bot.programmingPolicy?.enabled ? 'Habilitados · ver fila' : 'Desabilitados · histórico'}
                </Link>
              </Detail>
              <Detail label="Avaliações">
                <Link
                  href={`/bots/${encodeURIComponent(bot.id)}/avaliacoes`}
                  className="text-info-ink underline-offset-4 hover:underline"
                >
                  Candidatos, lotes e promoções
                </Link>
              </Detail>
            </dl>
          </section>
          <section className="rounded-xl border border-rule">
            <header className="flex h-11 items-center border-b border-rule px-4">
              <h2 className="text-sm font-semibold">Conexões</h2>
            </header>
            <div className="flex flex-wrap gap-1.5 px-4 py-3">
              <Connections bot={bot} />
            </div>
          </section>
        </div>
      </div>
    </article>
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
    [search, setSearch] = useState('');
  const selected = bots.data?.find((bot) => bot.id === botId);
  const action = useMutation({
    mutationFn: ({ id, operation }: { id: string; operation: Operation }) =>
      request<BotStatus>(`/api/bots/${encodeURIComponent(id)}/${operation}`, {}),
    onSuccess: async (_status, { id, operation }) => {
      const name = bots.data?.find((bot) => bot.id === id)?.name ?? 'Bot';
      toast.success(`${name} ${DONE[operation]}`);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error, { operation }) => toast.error(FAILED[operation], error.message),
  });
  const shown = bots.data?.filter((bot) =>
    botId ? bot.id === botId : bot.name.toLowerCase().includes(search.toLowerCase()),
  );
  const controls = (bot: ListedBot) => ({
    bot,
    busy: action.isPending,
    pending: action.isPending && action.variables?.id === bot.id,
    run: (operation: Operation) => action.mutate({ id: bot.id, operation }),
    edit: () => setEditing(bot),
  });
  return (
    <div className="space-y-6">
      <PageHeader
        {...(botId && {
          trail: [{ label: 'Bots', href: '/bots' }, { label: selected?.name ?? 'Carregando…' }],
        })}
        title={botId ? (selected?.name ?? (bots.isPending ? 'Carregando…' : botId)) : 'Bots'}
        {...(selected && {
          icon: selected.programming ? <Terminal aria-hidden /> : <Bot aria-hidden />,
          badges: (
            <Badge variant="secondary">{selected.programming ? 'Programador' : 'Assistente'}</Badge>
          ),
        })}
        actions={
          botId ? (
            selected && <BotControls {...controls(selected)} />
          ) : (
            <Button onClick={() => setEditing(null)}>
              <Plus aria-hidden />
              Novo bot
            </Button>
          )
        }
      />
      {bots.error && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar os bots</AlertTitle>
          <AlertDescription>{bots.error.message}</AlertDescription>
        </Alert>
      )}
      {bots.isPending && (
        <div className={listStyle}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-40" />
                <Skeleton className="h-3 w-72 max-w-full" />
              </div>
              <Skeleton className="hidden h-3.5 w-24 sm:block" />
            </div>
          ))}
        </div>
      )}
      {!botId && bots.data && (
        <>
          <MetricGrid>
            <Metric label="Bots" value={bots.data.length} icon={<Bot aria-hidden />} />
            <Metric
              label="Em execução"
              value={bots.data.filter((b) => b.status.state === 'running').length}
              icon={<Play aria-hidden />}
            />
            <Metric
              label="Programadores"
              value={bots.data.filter((b) => b.programming).length}
              icon={<Terminal aria-hidden />}
            />
            <Metric
              label="Conexões ativas"
              value={bots.data.reduce(
                (n, b) => n + b.status.connections.filter((c) => c.state === 'connected').length,
                0,
              )}
              icon={<Cable aria-hidden />}
            />
          </MetricGrid>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              className="max-w-sm"
              aria-label="Buscar bots"
              placeholder="Buscar bots…"
              shortcut="f"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="tabular ml-auto text-[13px] text-ink-muted">
              {shown?.length ?? 0} de {bots.data.length}
            </span>
          </div>
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
      {botId
        ? selected && (
            <BotOverview
              bot={selected}
              pending={action.isPending && action.variables?.id === selected.id}
            />
          )
        : !!shown?.length && (
            <section aria-label="Lista de bots" className={listStyle}>
              <div
                aria-hidden
                className={cn(
                  'hidden h-9 items-center gap-x-4 bg-paper px-4 text-[13px] text-ink-muted xl:grid',
                  ROW_GRID,
                )}
              >
                <span className="pl-11">Bot</span>
                <span>Estado</span>
                <span>Canais</span>
                <span>MCPs</span>
                <span className="pr-1.5 text-right">Ações</span>
              </div>
              {shown.map((bot) => (
                <BotRow key={bot.id} {...controls(bot)} />
              ))}
            </section>
          )}
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
          {editing !== undefined && (
            <BotEditor
              key={`${editing?.id ?? 'new'}-${editing?.revision ?? 0}`}
              profile={editing}
              onCancel={() => setEditing(undefined)}
              onSaved={(bot) => {
                setEditing(undefined);
                toast.success(`${bot.name} salvo`, 'Você já pode iniciá-lo ou reiniciá-lo.');
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
