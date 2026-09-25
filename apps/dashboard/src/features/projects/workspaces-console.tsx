'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FolderGit2,
  Boxes,
  MonitorPlay,
  GitBranch,
  Plus,
  ArrowUpRight,
  Settings2,
  Cpu,
  MemoryStick,
  Globe,
  MoreHorizontal,
  Play,
  Square,
  Activity,
  Bot,
  ScrollText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { PageHeader, SectionHeader } from '@/components/shared/page-header';
import { SearchField } from '@/components/shared/search-field';
import { EnvironmentEditor } from '@/features/environments/environment-editor';
import { cn } from '@/lib/utils/cn';
import { ProjectEditor } from './project-editor';
import { NetworkSettings } from './network-settings';
import { WorkspaceTasks } from './workspace-tasks';
import { Blank, Metric, MetricGrid, Status, listStyle } from './workspace-ui';
import { workspaceRequest, inputStyle, type RunnerCommandInput, type RunnerState } from './shared';

const queryKey = ['workspaces'];

/**
 * O que dizer quando cada comando termina. Leitura de estado, de log e o
 * terminal ficam de fora: o proprio resultado aparece na tela.
 */
const DONE: Partial<Record<RunnerCommandInput['action'], string>> = {
  saveProject: 'Projeto salvo',
  saveEnvironment: 'Ambiente salvo',
  saveSettings: 'Acesso às prévias atualizado',
  createTask: 'Tarefa criada',
  startSandbox: 'Preparando o sandbox',
  stopSandbox: 'Parando o sandbox',
  startPreview: 'Subindo a prévia',
  stopPreview: 'Parando a prévia',
  deletePreview: 'Excluindo a prévia',
};
const DONE_DETAIL: Partial<Record<RunnerCommandInput['action'], string>> = {
  saveSettings: 'As próximas prévias usarão este endereço.',
  createTask: 'A worktree está sendo preparada. Acompanhe em Atividade.',
  startSandbox: 'Acompanhe o andamento em Atividade.',
  startPreview: 'Os links aparecem aqui quando os serviços estiverem prontos.',
};

const JOB_LABEL: Record<string, string> = {
  createTask: 'Preparar worktrees',
  startPreview: 'Subir prévia',
  stopPreview: 'Parar prévia',
  deletePreview: 'Excluir prévia',
  startSandbox: 'Preparar sandbox',
  stopSandbox: 'Parar sandbox',
};

/** Icone circular neutro que abre a identidade de cada linha. */
function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-rule bg-canvas text-ink-muted [&_svg]:size-4">
      {children}
    </span>
  );
}

export function WorkspacesConsole({
  projectId,
  environmentId,
}: {
  projectId?: string;
  environmentId?: string;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    client = useQueryClient();
  const query = useQuery<RunnerState>({
    queryKey,
    queryFn: () => workspaceRequest<RunnerState>(),
    refetchInterval: 3000,
    retry: 1,
  });
  const [editor, setEditor] = useState<'project' | 'environment' | 'network'>(),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [reuse, setReuse] = useState('');
  const [log, setLog] = useState<{ title: string; text: string }>();
  /** `done` troca a mensagem padrão do comando; `false` silencia um passo intermediário. */
  async function act(command: RunnerCommandInput, done?: string | false) {
    setBusy(true);
    try {
      const value = await workspaceRequest(command);
      await client.invalidateQueries({ queryKey });
      const title = done ?? DONE[command.action];
      if (title) toast.success(title, done ? undefined : DONE_DETAIL[command.action]);
      return value;
    } catch (e) {
      toast.error('Não foi possível concluir', e instanceof Error ? e.message : 'Operação falhou.');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const trigger = (c: RunnerCommandInput) => void act(c).catch(() => {});
  async function showLogs(c: RunnerCommandInput, title: string) {
    try {
      const r = (await act(c)) as { text: string };
      setLog({ title, text: r.text || 'Nenhuma saída registrada ainda.' });
    } catch {
      /* error is visible */
    }
  }
  const state = query.data;
  if (!state)
    return (
      <div className="space-y-6">
        <PageHeader title="Projetos" />
        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível carregar os projetos</AlertTitle>
            <AlertDescription>
              <p>{query.error.message}</p>
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Skeleton className="h-24 w-full rounded-xl" />
            <div className={listStyle}>
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-3 px-4 py-3.5">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  const project = state.projects.find((p) => p.id === projectId);
  const envIds = project
    ? [
        ...new Set(
          [project.environmentId, ...(project.environmentIds ?? [])].filter(
            (id): id is string => !!id,
          ),
        ),
      ]
    : [];
  const environments = state.environments.filter((e) => envIds.includes(e.id));
  const environment = environments.find((e) => e.id === environmentId);
  if ((projectId && !project) || (environmentId && !environment))
    return (
      <Blank
        icon={<FolderGit2 />}
        title="Este endereço não está disponível"
        description="O projeto ou ambiente não foi encontrado."
      >
        <Button asChild>
          <Link href="/projetos">Voltar aos projetos</Link>
        </Button>
      </Blank>
    );
  const base = project ? `/projetos/${project.id}` : '/projetos';
  const current = environment ? `${base}/ambientes/${environment.id}` : base;
  const tasks = state.tasks.filter((t) => t.projectId === project?.id);
  const previews = state.previews.filter(
    (p) =>
      (!project || p.projectId === project.id) &&
      (!environment || p.environmentId === environment.id),
  );
  const jobs = state.jobs.filter((j) => j.projectId === project?.id);
  const tab = params.get('tab') ?? (environment ? 'previews' : 'environments');
  const setTab = (value: string) => router.replace(`${current}?tab=${value}`, { scroll: false });
  const matches = state.projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));
  async function attach(id: string, done = 'Ambiente vinculado ao projeto') {
    if (!project) return;
    await act(
      {
        action: 'saveProject',
        definition: {
          ...project,
          environmentId: project.environmentId ?? id,
          environmentIds: [...new Set([...envIds, id])],
        },
        revision: project.revision,
      },
      done,
    );
    setEditor(undefined);
    router.push(`${base}/ambientes/${id}`);
  }
  const activity = !jobs.length ? (
    <Blank
      icon={<Activity />}
      title="Nenhuma operação ainda"
      description="Preparações, builds e paradas deste projeto aparecerão aqui."
    />
  ) : (
    <div className={listStyle}>
      {jobs.slice(0, 20).map((job) => (
        <div
          key={job.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,1fr)_9rem_11rem_auto]"
        >
          <span className="truncate text-sm font-medium">{JOB_LABEL[job.type] ?? job.type}</span>
          <Status state={job.state} className="max-sm:hidden" />
          <time className="tabular text-[13px] text-ink-muted max-sm:hidden">
            {new Date(job.createdAt).toLocaleString('pt-BR')}
          </time>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void showLogs({ action: 'jobLogs', jobId: job.id }, 'Saída da operação')}
          >
            <ScrollText aria-hidden />
            Ver saída
          </Button>
          <div className="col-span-full flex items-center gap-3 sm:hidden">
            <Status state={job.state} />
            <time className="tabular text-xs text-ink-muted">
              {new Date(job.createdAt).toLocaleString('pt-BR')}
            </time>
          </div>
          {job.error && (
            <p className="col-span-full text-[13px] whitespace-pre-wrap text-error-ink">
              {job.error}
            </p>
          )}
        </div>
      ))}
    </div>
  );
  return (
    <div className="space-y-6">
      <PageHeader
        {...(project && {
          trail: [
            { label: 'Projetos', href: '/projetos' },
            { label: project.name, ...(environment ? { href: base } : {}) },
            ...(environment ? [{ label: environment.name }] : []),
          ],
        })}
        title={environment?.name ?? project?.name ?? 'Projetos'}
        {...(project && { icon: environment ? <Boxes aria-hidden /> : <FolderGit2 aria-hidden /> })}
        {...(environment && { badges: <Badge variant="secondary">Ambiente</Badge> })}
        actions={
          project ? (
            <>
              <Button
                variant="outline"
                onClick={() => setEditor(environment ? 'environment' : 'project')}
              >
                <Settings2 aria-hidden />
                Configurar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Ações do projeto">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52!">
                  <DropdownMenuItem
                    disabled={!project.environmentId || busy}
                    onSelect={() => trigger({ action: 'startSandbox', projectId: project.id })}
                  >
                    <Play />
                    Preparar sandbox
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => trigger({ action: 'stopSandbox', projectId: project.id })}
                  >
                    <Square />
                    Parar sandbox
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setEditor('network')}>
                    <Globe />
                    Acesso às prévias
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <Button onClick={() => setEditor('project')}>
              <Plus aria-hidden />
              Novo projeto
            </Button>
          )
        }
      />
      {query.error && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível atualizar os projetos</AlertTitle>
          <AlertDescription>{query.error.message}</AlertDescription>
        </Alert>
      )}
      <MetricGrid>
        {!project ? (
          <>
            <Metric
              label="Projetos"
              value={state.projects.length}
              icon={<FolderGit2 aria-hidden />}
            />
            <Metric
              label="Ambientes"
              value={
                state.environments.filter((e) =>
                  state.projects.some(
                    (p) => p.environmentId === e.id || p.environmentIds?.includes(e.id),
                  ),
                ).length
              }
              icon={<Boxes aria-hidden />}
            />
            <Metric
              label="Prévias disponíveis"
              value={previews.filter((p) => p.state === 'ready').length}
              icon={<MonitorPlay aria-hidden />}
            />
            <Metric label="Worktrees" value={state.tasks.length} icon={<GitBranch aria-hidden />} />
          </>
        ) : environment ? (
          <>
            <Metric
              label="Serviços"
              value={environment.compose ? 'Compose' : environment.services.length}
              icon={<Boxes aria-hidden />}
            />
            <Metric
              label="Prévias disponíveis"
              value={previews.filter((p) => p.state === 'ready').length}
              hint={`Até ${environment.maxPreviews} simultâneas`}
              icon={<MonitorPlay aria-hidden />}
            />
            <Metric
              label="CPU por container"
              value={`${environment.cpus} vCPU`}
              icon={<Cpu aria-hidden />}
            />
            <Metric
              label="Memória por container"
              value={`${environment.memoryMb} MB`}
              icon={<MemoryStick aria-hidden />}
            />
          </>
        ) : (
          <>
            <Metric label="Ambientes" value={environments.length} icon={<Boxes aria-hidden />} />
            <Metric label="Worktrees" value={tasks.length} icon={<GitBranch aria-hidden />} />
            <Metric
              label="Prévias disponíveis"
              value={previews.filter((p) => p.state === 'ready').length}
              icon={<MonitorPlay aria-hidden />}
            />
            <Metric
              label="Bots autorizados"
              value={project.allowedBotIds.length}
              icon={<Bot aria-hidden />}
            />
          </>
        )}
      </MetricGrid>
      {!project ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              className="max-w-sm"
              aria-label="Buscar projetos"
              placeholder="Buscar projetos…"
              shortcut="f"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="tabular ml-auto text-[13px] text-ink-muted">
              {matches.length} de {state.projects.length}
            </span>
          </div>
          {!!matches.length && (
            <section aria-label="Lista de projetos" className={listStyle}>
              {matches.map((p) => {
                const count = new Set(
                  [p.environmentId, ...(p.environmentIds ?? [])].filter(Boolean),
                ).size;
                return (
                  <article
                    key={p.id}
                    aria-label={p.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-paper lg:grid-cols-[minmax(0,1fr)_10rem_minmax(0,16rem)_auto] lg:gap-x-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <RowIcon>
                        <FolderGit2 aria-hidden />
                      </RowIcon>
                      <div className="min-w-0">
                        <Link
                          href={`/projetos/${p.id}`}
                          className="block truncate font-medium text-ink underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                        <p
                          className="mt-0.5 truncate font-mono text-xs text-ink-muted"
                          title={p.repositories[0]?.source}
                        >
                          {p.repositories[0]?.source}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="lg:order-last">
                      <Link href={`/projetos/${p.id}`}>
                        Abrir projeto
                        <ArrowUpRight aria-hidden />
                      </Link>
                    </Button>
                    <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-1.5 pl-11 lg:contents">
                      <Status state={state.sandboxes[p.id] ?? 'absent'} />
                      <p className="text-[13px] text-ink-muted">
                        {p.repositories.length} repositórios · {count} ambientes ·{' '}
                        {state.tasks.filter((t) => t.projectId === p.id).length} worktrees ·{' '}
                        {p.allowedBotIds.length} bots
                      </p>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
          {!state.projects.length && (
            <Blank
              icon={<FolderGit2 />}
              title="Um projeto, todo o contexto"
              description="Comece com seu repositório Git. Em seguida, adicione ambientes e publique prévias das suas worktrees."
            >
              <Button onClick={() => setEditor('project')}>
                <Plus aria-hidden />
                Criar primeiro projeto
              </Button>
            </Blank>
          )}
          {!!state.projects.length && !matches.length && (
            <Blank
              icon={<FolderGit2 />}
              title="Nenhum projeto encontrado"
              description="Tente outro nome para localizar o projeto."
            />
          )}
        </>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-6">
          <TabsList variant="line" className="w-full! max-w-full overflow-x-auto">
            {environment ? (
              <>
                <TabsTrigger value="previews">
                  <MonitorPlay />
                  Prévias
                </TabsTrigger>
                <TabsTrigger value="services">
                  <Boxes />
                  Serviços
                </TabsTrigger>
              </>
            ) : (
              <>
                <TabsTrigger value="environments">
                  <Boxes />
                  Ambientes
                </TabsTrigger>
                <TabsTrigger value="worktrees">
                  <GitBranch />
                  Worktrees
                </TabsTrigger>
                <TabsTrigger value="repositories">
                  <FolderGit2 />
                  Repositórios
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="activity">
              <Activity />
              Atividade
            </TabsTrigger>
          </TabsList>
          <TabsContent value="environments" className="space-y-4">
            <SectionHeader
              title="Ambientes do projeto"
              description="Cada configuração tem seus serviços e suas prévias."
              actions={
                <Button onClick={() => setEditor('environment')}>
                  <Plus aria-hidden />
                  Novo ambiente
                </Button>
              }
            />
            {environments.length ? (
              <div className={listStyle}>
                {environments.map((env) => (
                  <article
                    key={env.id}
                    aria-label={env.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)_9rem_auto] lg:gap-x-6"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <RowIcon>
                        <Boxes aria-hidden />
                      </RowIcon>
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <Link
                            className="truncate font-medium text-ink underline-offset-4 hover:underline"
                            href={`${base}/ambientes/${env.id}`}
                          >
                            {env.name}
                          </Link>
                          {env.id === project.environmentId && (
                            <Badge variant="info">Padrão do sandbox</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
                          {env.compose ? (
                            <>
                              Compose ·{' '}
                              <span className="font-mono text-xs">{env.compose.path}</span>
                            </>
                          ) : (
                            `${env.services.length} serviços configurados`
                          )}
                        </p>
                      </div>
                    </div>
                    <Button asChild variant="ghost" size="sm" className="lg:order-last">
                      <Link href={`${base}/ambientes/${env.id}`}>
                        Abrir ambiente
                        <ArrowUpRight aria-hidden />
                      </Link>
                    </Button>
                    <div className="col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 pl-11 lg:contents">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">
                          <Cpu aria-hidden />
                          {env.cpus} vCPU
                        </Badge>
                        <Badge variant="outline">
                          <MemoryStick aria-hidden />
                          {env.memoryMb} MB
                        </Badge>
                        <Badge variant="outline">
                          <Globe aria-hidden />
                          {env.network === 'none' ? 'Sem rede externa' : 'Internet'}
                        </Badge>
                      </div>
                      <span className="tabular text-[13px] text-ink-muted">
                        {
                          state.previews.filter(
                            (p) =>
                              p.projectId === project.id &&
                              p.environmentId === env.id &&
                              p.state === 'ready',
                          ).length
                        }{' '}
                        prévias disponíveis
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Blank
                icon={<Boxes />}
                title="Prepare o primeiro ambiente"
                description="Escolha as ferramentas e os serviços para trabalhar e testar este projeto."
              >
                <Button onClick={() => setEditor('environment')}>
                  <Plus aria-hidden />
                  Adicionar ambiente
                </Button>
              </Blank>
            )}
          </TabsContent>
          <TabsContent value="worktrees">
            <WorkspaceTasks
              state={state}
              project={project}
              act={act}
              busy={busy}
              showLogs={showLogs}
            />
          </TabsContent>
          <TabsContent value="previews">
            <WorkspaceTasks
              state={state}
              project={project}
              environmentId={environment?.id}
              act={act}
              busy={busy}
              showLogs={showLogs}
            />
          </TabsContent>
          <TabsContent value="repositories" className="space-y-4">
            <SectionHeader
              title="Repositórios"
              description="Origens Git clonadas para cada worktree deste projeto."
            />
            <div className={listStyle}>
              {project.repositories.map((repo) => (
                <div
                  key={repo.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
                >
                  <RowIcon>
                    <FolderGit2 aria-hidden />
                  </RowIcon>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-mono text-sm font-medium">{repo.id}</h3>
                    <p className="mt-0.5 font-mono text-xs break-all text-ink-muted">
                      {repo.source}
                    </p>
                  </div>
                  <Badge variant="outline" className="font-mono">
                    <GitBranch aria-hidden />
                    {repo.ref}
                  </Badge>
                </div>
              ))}
            </div>
            <Alert>
              <Bot aria-hidden />
              <AlertTitle>Bots autorizados</AlertTitle>
              <AlertDescription>
                {project.allowedBotIds.join(', ') ||
                  'Nenhum bot autorizado. Configure o projeto para conceder acesso.'}
              </AlertDescription>
            </Alert>
          </TabsContent>
          <TabsContent value="services" className="space-y-4">
            <SectionHeader
              title="Serviços"
              description="O que sobe em cada prévia deste ambiente."
              actions={
                <Button variant="outline" onClick={() => setEditor('environment')}>
                  <Settings2 aria-hidden />
                  Configurar serviços
                </Button>
              }
            />
            {environment?.compose ? (
              <div className="rounded-xl border border-rule px-4 py-3.5">
                <h3 className="text-sm font-medium">Serviços definidos por Compose</h3>
                <p className="mt-0.5 font-mono text-xs text-ink-muted">
                  {environment.compose.repositoryId} · {environment.compose.path}
                </p>
                <p className="mt-3 text-[13px] text-ink-muted">
                  O arquivo da worktree selecionada define os serviços desta prévia.
                </p>
              </div>
            ) : environment?.services.length ? (
              <Accordion type="multiple" className="rounded-xl border border-rule px-4">
                {environment.services.map((service) => (
                  <AccordionItem key={service.id} value={service.id}>
                    <AccordionTrigger>
                      <span className="flex flex-wrap items-center gap-2.5">
                        <Boxes className="size-4 text-ink-muted" aria-hidden />
                        <span className="font-mono">{service.id}</span>
                        <Badge variant="secondary" className="font-mono">
                          {service.builder}
                        </Badge>
                        <Badge variant="outline">
                          {service.mode === 'development' ? 'Hot reload' : 'Imagem'}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <dl className="grid gap-px overflow-hidden rounded-lg border border-rule bg-rule sm:grid-cols-2">
                        {Object.entries({
                          Origem: service.repositoryId ?? service.image,
                          Contexto: service.context,
                          Porta: String(service.port),
                          Acesso: service.expose ? 'Navegador' : 'Interno',
                          Comando: service.command || 'Padrão da imagem',
                          Dependências: service.dependsOn.join(', ') || 'Nenhuma',
                        }).map(([label, value]) => (
                          <div key={label} className="bg-canvas px-3 py-2.5">
                            <dt className="text-xs text-ink-muted">{label}</dt>
                            <dd className="mt-1 font-mono text-xs break-all">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            ) : (
              <Blank
                icon={<Boxes />}
                title="Adicione os serviços da aplicação"
                description="Use imagem pronta, Dockerfile, Railpack ou um arquivo Compose."
              />
            )}
          </TabsContent>
          <TabsContent value="activity" className="space-y-4">
            <SectionHeader
              title="Atividade"
              description="Operações de todos os ambientes deste projeto."
            />
            {activity}
          </TabsContent>
        </Tabs>
      )}
      <Sheet
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>
              {editor === 'project'
                ? project
                  ? 'Configurar projeto'
                  : 'Novo projeto'
                : editor === 'network'
                  ? 'Acesso às prévias'
                  : environment
                    ? 'Configurar ambiente'
                    : 'Novo ambiente'}
            </SheetTitle>
            <SheetDescription>
              {editor === 'network'
                ? 'Esta configuração de rede é compartilhada por todas as prévias.'
                : project
                  ? `Configurações de ${project.name}.`
                  : 'Conecte os repositórios e autorize os bots.'}
            </SheetDescription>
          </SheetHeader>
          {editor === 'project' && (
            <ProjectEditor
              project={project}
              cancel={() => setEditor(undefined)}
              save={async (c) => {
                await act(c);
                setEditor(undefined);
                if (c.action === 'saveProject') router.push(`/projetos/${c.definition.id}`);
              }}
            />
          )}
          {editor === 'environment' && (
            <>
              {!environment && state.environments.some((e) => !envIds.includes(e.id)) && (
                <Accordion
                  type="single"
                  collapsible
                  className="mx-6 mt-5 w-auto! rounded-xl border border-rule px-4"
                >
                  <AccordionItem value="reuse">
                    <AccordionTrigger>Reutilizar configuração existente</AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      <p className="text-[13px] text-ink-muted">
                        Alterações em uma configuração compartilhada afetam os projetos que a
                        utilizam.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <select
                          aria-label="Ambiente existente"
                          className={cn(inputStyle, 'min-w-48! flex-1')}
                          value={reuse}
                          onChange={(e) => setReuse(e.target.value)}
                        >
                          <option value="">Selecione</option>
                          {state.environments
                            .filter((e) => !envIds.includes(e.id))
                            .map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                        </select>
                        <Button
                          disabled={!reuse || busy}
                          onClick={() => void attach(reuse).catch(() => {})}
                        >
                          Vincular ambiente
                        </Button>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
              <EnvironmentEditor
                environment={environment}
                cancel={() => setEditor(undefined)}
                save={async (c) => {
                  // Um ambiente novo so esta pronto depois de vinculado: um aviso so.
                  const created = c.action === 'saveEnvironment' && !environment;
                  await act(c, created ? false : undefined);
                  if (created) await attach(c.definition.id, 'Ambiente criado');
                  else setEditor(undefined);
                }}
              />
            </>
          )}
          {editor === 'network' && state.settings && (
            <NetworkSettings
              state={state}
              save={async (c) => {
                await act(c);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!log}
        onOpenChange={(open) => {
          if (!open) setLog(undefined);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle>{log?.title}</SheetTitle>
            <SheetDescription>
              Saída registrada pelo gerenciador. Segredos conhecidos são ocultados.
            </SheetDescription>
          </SheetHeader>
          <pre className="m-6 overflow-auto rounded-lg border border-rule bg-paper p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink">
            {log?.text}
          </pre>
        </SheetContent>
      </Sheet>
    </div>
  );
}
