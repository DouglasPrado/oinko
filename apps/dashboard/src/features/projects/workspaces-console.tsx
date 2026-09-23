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
  Search,
  MoreHorizontal,
  Play,
  Square,
  Activity,
  Bot,
  ScrollText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
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
import { Input } from '@/components/ui/input';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { EnvironmentEditor } from '@/features/environments/environment-editor';
import { ProjectEditor } from './project-editor';
import { NetworkSettings } from './network-settings';
import { WorkspaceTasks } from './workspace-tasks';
import { Blank, Metric, Status, Trail } from './workspace-ui';
import { workspaceRequest, inputStyle, type RunnerCommandInput, type RunnerState } from './shared';

const queryKey = ['workspaces'];
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
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [reuse, setReuse] = useState('');
  const [log, setLog] = useState<{ title: string; text: string }>();
  async function act(command: RunnerCommandInput) {
    setBusy(true);
    setError('');
    try {
      const value = await workspaceRequest(command);
      await client.invalidateQueries({ queryKey });
      return value;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operação falhou.');
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
      <div className="space-y-5">
        <h1 className="text-3xl font-semibold">Projetos</h1>
        {query.error ? (
          <Alert variant="destructive">
            <AlertTitle>Não foi possível carregar os projetos</AlertTitle>
            <AlertDescription>
              {query.error.message}
              <Button variant="outline" onClick={() => void query.refetch()}>
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <Skeleton className="h-12 w-64" />
            <div className="grid gap-4 md:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <Skeleton key={n} className="h-40" />
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
  async function attach(id: string) {
    if (!project) return;
    await act({
      action: 'saveProject',
      definition: {
        ...project,
        environmentId: project.environmentId ?? id,
        environmentIds: [...new Set([...envIds, id])],
      },
      revision: project.revision,
    });
    setEditor(undefined);
    router.push(`${base}/ambientes/${id}`);
  }
  const activity = (
    <div className="space-y-3">
      {!jobs.length ? (
        <Blank
          icon={<Activity />}
          title="Nenhuma operação ainda"
          description="Preparações, builds e paradas deste projeto aparecerão aqui."
        />
      ) : (
        jobs.slice(0, 20).map((job) => (
          <Card key={job.id} className="py-0 shadow-none">
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <Activity className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {(
                  {
                    createTask: 'Preparar worktrees',
                    startPreview: 'Subir prévia',
                    stopPreview: 'Parar prévia',
                    startSandbox: 'Preparar sandbox',
                    stopSandbox: 'Parar sandbox',
                  } as Record<string, string>
                )[job.type] ?? job.type}
              </span>
              <Status state={job.state} />
              <time className="text-xs text-muted-foreground">
                {new Date(job.createdAt).toLocaleString('pt-BR')}
              </time>
              <Button
                className="ml-auto"
                variant="ghost"
                onClick={() =>
                  void showLogs({ action: 'jobLogs', jobId: job.id }, 'Saída da operação')
                }
              >
                <ScrollText />
                Ver saída
              </Button>
              {job.error && <p className="w-full text-sm text-destructive">{job.error}</p>}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
  return (
    <div className="space-y-7">
      <Trail
        items={[
          { label: 'Projetos', ...(project ? { href: '/projetos' } : {}) },
          ...(project ? [{ label: project.name, ...(environment ? { href: base } : {}) }] : []),
          ...(environment ? [{ label: environment.name }] : []),
        ]}
      />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 gap-4">
          <div className="hidden size-12 shrink-0 items-center justify-center rounded-xl border bg-card sm:flex">
            {environment ? (
              <Boxes className="size-6 text-primary" />
            ) : (
              <FolderGit2 className="size-6 text-primary" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight">
                {environment?.name ?? project?.name ?? 'Seus projetos'}
              </h1>
              {environment && <Badge variant="secondary">Ambiente</Badge>}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {environment
                ? 'Serviços, configurações e prévias deste ambiente.'
                : project
                  ? 'Do código à prévia, tudo no contexto deste projeto.'
                  : 'Organize o código, conecte seus bots e teste cada mudança.'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {project ? (
            <>
              <Button
                variant="outline"
                onClick={() => setEditor(environment ? 'environment' : 'project')}
              >
                <Settings2 />
                Configurar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Ações do projeto">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
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
              <Plus />
              Novo projeto
            </Button>
          )}
        </div>
      </header>
      {(error || query.error) && (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível concluir</AlertTitle>
          <AlertDescription>{error || query.error?.message}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {!project ? (
          <>
            <Metric
              label="Projetos"
              value={state.projects.length}
              icon={<FolderGit2 className="size-4" />}
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
              icon={<Boxes className="size-4" />}
            />
            <Metric
              label="Prévias disponíveis"
              value={previews.filter((p) => p.state === 'ready').length}
              icon={<MonitorPlay className="size-4" />}
            />
            <Metric
              label="Worktrees"
              value={state.tasks.length}
              icon={<GitBranch className="size-4" />}
            />
          </>
        ) : environment ? (
          <>
            <Metric
              label="Serviços"
              value={environment.compose ? 'Compose' : environment.services.length}
              icon={<Boxes className="size-4" />}
            />
            <Metric
              label="Prévias disponíveis"
              value={previews.filter((p) => p.state === 'ready').length}
              hint={`Até ${environment.maxPreviews} simultâneas`}
              icon={<MonitorPlay className="size-4" />}
            />
            <Metric
              label="CPU por container"
              value={`${environment.cpus} vCPU`}
              icon={<Cpu className="size-4" />}
            />
            <Metric
              label="Memória por container"
              value={`${environment.memoryMb} MB`}
              icon={<MemoryStick className="size-4" />}
            />
          </>
        ) : (
          <>
            <Metric
              label="Ambientes"
              value={environments.length}
              icon={<Boxes className="size-4" />}
            />
            <Metric
              label="Worktrees"
              value={tasks.length}
              icon={<GitBranch className="size-4" />}
            />
            <Metric
              label="Prévias disponíveis"
              value={previews.filter((p) => p.state === 'ready').length}
              icon={<MonitorPlay className="size-4" />}
            />
            <Metric
              label="Bots autorizados"
              value={project.allowedBotIds.length}
              icon={<Bot className="size-4" />}
            />
          </>
        )}
      </div>
      {!project ? (
        <>
          <div className="relative max-w-sm">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              aria-label="Buscar projetos"
              placeholder="Buscar projetos…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            {state.projects
              .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
              .map((p) => (
                <Card
                  key={p.id}
                  className="gap-4 shadow-none transition-colors hover:border-primary/40"
                >
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle>
                        <Link
                          href={`/projetos/${p.id}`}
                          className="flex items-center gap-2 hover:text-primary"
                        >
                          <FolderGit2 className="size-5" />
                          {p.name}
                        </Link>
                      </CardTitle>
                      <Status state={state.sandboxes[p.id] ?? 'absent'} />
                    </div>
                    <CardDescription className="truncate">
                      {p.repositories[0]?.source}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{p.repositories.length} repositórios</Badge>
                    <Badge variant="outline">
                      {new Set([p.environmentId, ...(p.environmentIds ?? [])].filter(Boolean)).size}{' '}
                      ambientes
                    </Badge>
                    <Badge variant="outline">
                      {state.tasks.filter((t) => t.projectId === p.id).length} worktrees
                    </Badge>
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <span className="text-xs text-muted-foreground">
                      {p.allowedBotIds.length} bots autorizados
                    </span>
                    <Button asChild variant="ghost" className="ml-auto">
                      <Link href={`/projetos/${p.id}`}>
                        Abrir projeto
                        <ArrowUpRight />
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
          </div>
          {!state.projects.length && (
            <Blank
              icon={<FolderGit2 />}
              title="Um projeto, todo o contexto"
              description="Comece com seu repositório Git. Em seguida, adicione ambientes e publique prévias das suas worktrees."
            >
              <Button onClick={() => setEditor('project')}>
                <Plus />
                Criar primeiro projeto
              </Button>
            </Blank>
          )}
          {!!state.projects.length &&
            !state.projects.some((p) => p.name.toLowerCase().includes(search.toLowerCase())) && (
              <Blank
                icon={<Search />}
                title="Nenhum projeto encontrado"
                description="Tente outro nome para localizar o projeto."
              />
            )}
        </>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="gap-6">
          <TabsList variant="line" className="max-w-full overflow-x-auto border-b">
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
          <TabsContent value="environments">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Ambientes do projeto</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Cada configuração tem seus serviços e suas prévias.
                </p>
              </div>
              <Button onClick={() => setEditor('environment')}>
                <Plus />
                Novo ambiente
              </Button>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {environments.map((env) => (
                <Card key={env.id} className="shadow-none">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>
                        <Link className="hover:text-primary" href={`${base}/ambientes/${env.id}`}>
                          {env.name}
                        </Link>
                      </CardTitle>
                      {env.id === project.environmentId && (
                        <Badge variant="secondary">Padrão do sandbox</Badge>
                      )}
                    </div>
                    <CardDescription>
                      {env.compose
                        ? `Compose · ${env.compose.path}`
                        : `${env.services.length} serviços configurados`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      <Cpu />
                      {env.cpus} vCPU
                    </Badge>
                    <Badge variant="outline">
                      <MemoryStick />
                      {env.memoryMb} MB
                    </Badge>
                    <Badge variant="outline">
                      <Globe />
                      {env.network === 'none' ? 'Sem rede externa' : 'Internet'}
                    </Badge>
                  </CardContent>
                  <CardFooter className="border-t pt-4">
                    <span className="text-xs text-muted-foreground">
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
                    <Button asChild variant="ghost" className="ml-auto">
                      <Link href={`${base}/ambientes/${env.id}`}>
                        Abrir ambiente
                        <ArrowUpRight />
                      </Link>
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
            {!environments.length && (
              <Blank
                icon={<Boxes />}
                title="Prepare o primeiro ambiente"
                description="Escolha as ferramentas e os serviços para trabalhar e testar este projeto."
              >
                <Button onClick={() => setEditor('environment')}>
                  <Plus />
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
          <TabsContent value="repositories">
            <div className="space-y-4">
              {project.repositories.map((repo) => (
                <Card key={repo.id} className="shadow-none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FolderGit2 className="size-4" />
                      {repo.id}
                    </CardTitle>
                    <CardDescription className="break-all">{repo.source}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Badge variant="outline">
                      <GitBranch />
                      {repo.ref}
                    </Badge>
                  </CardContent>
                </Card>
              ))}
              <Alert>
                <Bot />
                <AlertTitle>Bots autorizados</AlertTitle>
                <AlertDescription>
                  {project.allowedBotIds.join(', ') ||
                    'Nenhum bot autorizado. Configure o projeto para conceder acesso.'}
                </AlertDescription>
              </Alert>
            </div>
          </TabsContent>
          <TabsContent value="services">
            {environment?.compose ? (
              <Card>
                <CardHeader>
                  <CardTitle>Serviços definidos por Compose</CardTitle>
                  <CardDescription>
                    {environment.compose.repositoryId} · {environment.compose.path}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  O arquivo da worktree selecionada define os serviços desta prévia.
                </CardContent>
              </Card>
            ) : environment?.services.length ? (
              <Accordion type="multiple" className="rounded-xl border bg-card px-5">
                {environment.services.map((service) => (
                  <AccordionItem key={service.id} value={service.id}>
                    <AccordionTrigger>
                      <span className="flex flex-wrap items-center gap-3">
                        <Boxes className="size-4" />
                        {service.id}
                        <Badge variant="secondary">{service.builder}</Badge>
                        <Badge variant="outline">
                          {service.mode === 'development' ? 'Hot reload' : 'Imagem'}
                        </Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent>
                      <dl className="grid gap-4 sm:grid-cols-2">
                        {Object.entries({
                          Origem: service.repositoryId ?? service.image,
                          Contexto: service.context,
                          Porta: String(service.port),
                          Acesso: service.expose ? 'Navegador' : 'Interno',
                          Comando: service.command || 'Padrão da imagem',
                          Dependências: service.dependsOn.join(', ') || 'Nenhuma',
                        }).map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-xs text-muted-foreground">{label}</dt>
                            <dd className="mt-1 break-all font-mono text-xs">{value}</dd>
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
              >
                <Button onClick={() => setEditor('environment')}>Configurar serviços</Button>
              </Blank>
            )}
          </TabsContent>
          <TabsContent value="activity">
            <p className="mb-4 text-sm text-muted-foreground">
              Operações de todos os ambientes deste projeto.
            </p>
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
          <div className="p-6">
            {error && (
              <Alert variant="destructive" className="mb-5">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
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
                <EnvironmentEditor
                  environment={environment}
                  cancel={() => setEditor(undefined)}
                  save={async (c) => {
                    await act(c);
                    if (c.action === 'saveEnvironment' && !environment)
                      await attach(c.definition.id);
                    else setEditor(undefined);
                  }}
                />
                {!environment && state.environments.some((e) => !envIds.includes(e.id)) && (
                  <Accordion type="single" collapsible className="mt-6">
                    <AccordionItem value="reuse">
                      <AccordionTrigger>Reutilizar configuração existente</AccordionTrigger>
                      <AccordionContent>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Alterações em uma configuração compartilhada afetam os projetos que a
                          utilizam.
                        </p>
                        <select
                          aria-label="Ambiente existente"
                          className={inputStyle}
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
                          className="mt-3"
                          disabled={!reuse || busy}
                          onClick={() => void attach(reuse).catch(() => {})}
                        >
                          Vincular ambiente
                        </Button>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}
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
          </div>
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
          <pre className="m-6 overflow-auto rounded-xl bg-zinc-950 p-5 text-xs text-zinc-100 whitespace-pre-wrap">
            {log?.text}
          </pre>
        </SheetContent>
      </Sheet>
    </div>
  );
}
