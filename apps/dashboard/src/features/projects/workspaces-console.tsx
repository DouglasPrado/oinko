'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EnvironmentEditor } from '@/features/environments/environment-editor';
import { ProjectEditor } from './project-editor';
import {
  Field,
  inputStyle,
  buttonStyle,
  panelStyle,
  slug,
  stateLabel,
  workspaceRequest,
  type RunnerCommandInput,
  type RunnerState,
} from './shared';

const queryKey = ['workspaces'];
const titles = {
  projects: ['Projetos', 'Repositórios, bots autorizados e tarefas em worktrees.'],
  environments: ['Ambientes', 'Ferramentas de programação e serviços para testar suas aplicações.'],
  previews: ['Prévias', 'Execute uma worktree, acompanhe os serviços e abra a aplicação.'],
};
export function WorkspacesConsole({ view }: { view: keyof typeof titles }) {
  const client = useQueryClient();
  const query = useQuery<RunnerState>({
    queryKey,
    queryFn: () => workspaceRequest<RunnerState>(),
    refetchInterval: 3000,
    retry: 1,
  });
  const [editor, setEditor] = useState<string>();
  const [projectId, setProjectId] = useState('');
  const [taskName, setTaskName] = useState('');
  const [branch, setBranch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ title: string; text: string }>();
  const [terminalTask, setTerminalTask] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [command, setCommand] = useState('git status --short');
  const [terminalOutput, setTerminalOutput] = useState('');
  async function act(command: RunnerCommandInput) {
    setBusy(true);
    setError('');
    try {
      const result = await workspaceRequest(command);
      await client.invalidateQueries({ queryKey });
      return result;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Operação falhou.');
      throw error;
    } finally {
      setBusy(false);
    }
  }
  const trigger = (command: RunnerCommandInput) => {
    void act(command).catch(() => {});
  };
  const save = async (command: RunnerCommandInput) => {
    await act(command);
    setEditor(undefined);
  };
  async function showLogs(command: RunnerCommandInput, title: string) {
    try {
      const result = (await act(command)) as { text: string };
      setLog({ title, text: result.text || 'Nenhuma saída registrada ainda.' });
    } catch {
      /* displayed above */
    }
  }
  const state = query.data;
  if (!state)
    return (
      <section className={panelStyle}>
        <h1 className="text-2xl font-medium">{titles[view][0]}</h1>
        {query.error ? (
          <>
            <p role="alert" className="text-sm text-fault">
              {query.error.message}
            </p>
            <button className={buttonStyle} onClick={() => void query.refetch()}>
              Tentar novamente
            </button>
          </>
        ) : (
          <p className="text-sm text-ink-muted">Conectando ao gerenciador local…</p>
        )}
      </section>
    );
  if (editor && view === 'environments')
    return (
      <EnvironmentEditor
        key={editor}
        environment={state.environments.find((env) => env.id === editor)}
        save={save}
        cancel={() => setEditor(undefined)}
      />
    );
  if (editor && view === 'projects')
    return (
      <ProjectEditor
        key={editor}
        project={state.projects.find((project) => project.id === editor)}
        state={state}
        save={save}
        cancel={() => setEditor(undefined)}
      />
    );
  const selected = state.projects.find((project) => project.id === projectId) ?? state.projects[0];
  const tasks = state.tasks.filter((task) => task.projectId === selected?.id);
  const activeJobs = state.jobs.filter((job) => ['queued', 'running'].includes(job.state));
  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const id = `${slug(taskName) || 'task'}-${crypto.randomUUID().slice(0, 6)}`;
    try {
      await act({
        action: 'createTask',
        definition: { id, name: taskName, branch: branch || `task/${id}`, projectId: selected.id },
      });
      setTaskName('');
      setBranch('');
    } catch {
      /* displayed above */
    }
  }
  async function runTerminal(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      const result = (await act({
        action: 'shell',
        taskId: terminalTask,
        repositoryId: repositoryId || selected.repositories[0]!.id,
        command,
      })) as { stdout: string; stderr: string; exitCode: number };
      setTerminalOutput(`${result.stdout}${result.stderr}\nCódigo de saída: ${result.exitCode}`);
    } catch {
      /* displayed above */
    }
  }
  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">{titles[view][0]}</h1>
          <p className="mt-2 text-sm text-ink-muted">{titles[view][1]}</p>
        </div>
        {view !== 'previews' && (
          <button
            className={buttonStyle}
            disabled={view === 'projects' && !state.environments.length}
            onClick={() => setEditor('@new')}
          >
            {view === 'projects' ? 'Novo projeto' : 'Novo ambiente'}
          </button>
        )}
      </header>
      {(error || query.error) && (
        <p
          role="alert"
          className="border border-fault/30 bg-surface p-4 text-sm text-fault whitespace-pre-wrap"
        >
          {error || query.error?.message}
        </p>
      )}
      {view === 'environments' && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {state.environments.map((env) => (
              <article key={env.id} className={panelStyle}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-medium">{env.name}</h2>
                  <button className={buttonStyle} onClick={() => setEditor(env.id)}>
                    Configurar
                  </button>
                </div>
                <p className="text-sm text-ink-muted">
                  {env.services.length} serviços · {env.cpus} CPUs · {env.memoryMb} MB por container
                </p>
                <p className="text-sm">
                  {env.compose
                    ? `Compose: ${env.compose.path}`
                    : env.services
                        .map((service) => `${service.id} (${service.builder})`)
                        .join(', ') || 'Serviços ainda não configurados'}
                </p>
                <p className="text-xs text-ink-muted">
                  {state.projects.filter((project) => project.environmentId === env.id).length}{' '}
                  projetos usam esta configuração.
                </p>
              </article>
            ))}
          </div>
          {!state.environments.length && (
            <section className={panelStyle}>
              <p>
                Crie um ambiente para definir as ferramentas do bot e como sua aplicação será
                executada.
              </p>
            </section>
          )}
          {state.settings && (
            <NetworkSettings
              state={state}
              save={async (command) => {
                await act(command);
              }}
            />
          )}
        </>
      )}
      {view === 'projects' && (
        <>
          {!state.environments.length && (
            <p className="text-sm">
              Primeiro,{' '}
              <Link className="underline" href="/ambientes">
                configure um ambiente
              </Link>
              .
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {state.projects.map((project) => (
              <article key={project.id} className={panelStyle}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{project.name}</h2>
                    <p className="mt-1 text-xs text-ink-muted">
                      {state.environments.find((env) => env.id === project.environmentId)?.name} ·
                      Sandbox:{' '}
                      {stateLabel[state.sandboxes[project.id] ?? 'absent'] ??
                        state.sandboxes[project.id]}
                    </p>
                  </div>
                  <button className={buttonStyle} onClick={() => setEditor(project.id)}>
                    Configurar
                  </button>
                </div>
                <ul className="space-y-2 text-sm">
                  {project.repositories.map((repo) => (
                    <li key={repo.id} className="break-all">
                      <span className="font-medium">{repo.id}</span> · {repo.source}
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonStyle}
                    disabled={busy}
                    onClick={() => trigger({ action: 'startSandbox', projectId: project.id })}
                  >
                    Preparar sandbox
                  </button>
                  <button
                    className={buttonStyle}
                    disabled={busy}
                    onClick={() => trigger({ action: 'stopSandbox', projectId: project.id })}
                  >
                    Parar sandbox
                  </button>
                  <button
                    className={buttonStyle}
                    onClick={() => {
                      setProjectId(project.id);
                      document
                        .getElementById('project-tasks')
                        ?.scrollIntoView({ behavior: 'smooth' });
                    }}
                  >
                    Tarefas ({state.tasks.filter((task) => task.projectId === project.id).length})
                  </button>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {view !== 'environments' && selected && (
        <section id="project-tasks" className="space-y-5 scroll-mt-6">
          <div className="max-w-md">
            <Field label="Projeto selecionado">
              <select
                className={inputStyle}
                value={selected.id}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  setTerminalTask('');
                }}
              >
                {state.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {view === 'projects' && (
            <form
              onSubmit={(event) => void createTask(event)}
              className={panelStyle}
              aria-label="Nova tarefa"
            >
              <h2 className="font-medium">Criar tarefa e worktrees</h2>
              <div className="grid items-end gap-4 md:grid-cols-3">
                <Field label="Nome da tarefa">
                  <input
                    className={inputStyle}
                    required
                    value={taskName}
                    onChange={(event) => setTaskName(event.target.value)}
                    placeholder="Ajustar checkout"
                  />
                </Field>
                <Field label="Branch" help="Vazio cria um nome único para a tarefa.">
                  <input
                    className={inputStyle}
                    value={branch}
                    onChange={(event) => setBranch(event.target.value)}
                    placeholder="task/ajustar-checkout"
                  />
                </Field>
                <button className={buttonStyle} disabled={busy}>
                  Criar tarefa
                </button>
              </div>
            </form>
          )}
          <div className="space-y-4">
            {tasks.map((task) => {
              const preview = state.previews.find((item) => item.taskId === task.id);
              const pending = activeJobs.some((job) => job.projectId === task.projectId);
              return (
                <article key={task.id} className={panelStyle}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{task.name}</h3>
                      <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                        {task.branch}
                      </p>
                    </div>
                    <span className="text-sm">{stateLabel[preview?.state ?? task.state]}</span>
                  </div>
                  {(task.error || preview?.error) && (
                    <p className="text-sm text-fault whitespace-pre-wrap">
                      {task.error || preview?.error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className={buttonStyle}
                      disabled={busy || pending || task.state !== 'ready'}
                      onClick={() => trigger({ action: 'startPreview', taskId: task.id })}
                    >
                      {preview?.state === 'ready' ? 'Reconstruir prévia' : 'Subir prévia'}
                    </button>
                    {preview && (
                      <>
                        <button
                          className={buttonStyle}
                          disabled={busy || pending || preview.state === 'stopped'}
                          onClick={() => trigger({ action: 'stopPreview', previewId: preview.id })}
                        >
                          Parar prévia
                        </button>
                        <button
                          className={buttonStyle}
                          onClick={() =>
                            void showLogs(
                              { action: 'previewLogs', previewId: preview.id },
                              `Logs · ${task.name}`,
                            )
                          }
                        >
                          Logs dos serviços
                        </button>
                      </>
                    )}
                    <button
                      className={buttonStyle}
                      disabled={task.state !== 'ready'}
                      onClick={() => {
                        setTerminalTask(task.id);
                        setRepositoryId(selected.repositories[0]!.id);
                        setTerminalOutput('');
                      }}
                    >
                      Terminal
                    </button>
                    {task.state === 'failed' && (
                      <button
                        className={buttonStyle}
                        disabled={busy || pending}
                        onClick={() => trigger({ action: 'createTask', definition: task })}
                      >
                        Tentar preparar novamente
                      </button>
                    )}
                  </div>
                  {preview?.state === 'ready' && (
                    <div className="flex flex-wrap gap-3">
                      {preview.urls.map((link) => (
                        <a
                          className="break-all text-sm text-time underline"
                          key={link.serviceId}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Abrir {link.serviceId} ↗
                        </a>
                      ))}
                      {!preview.urls.length && (
                        <p className="text-xs text-ink-muted">
                          Serviços executando sem rota de navegador.
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {!tasks.length && (
            <p className="text-sm text-ink-muted">
              Nenhuma tarefa neste projeto. Crie uma em{' '}
              <Link href="/projetos" className="underline">
                Projetos
              </Link>
              .
            </p>
          )}
          {terminalTask && (
            <form
              onSubmit={(event) => void runTerminal(event)}
              className={panelStyle}
              aria-label="Terminal do sandbox"
            >
              <div className="flex justify-between gap-3">
                <h3 className="font-medium">
                  Terminal · {tasks.find((task) => task.id === terminalTask)?.name}
                </h3>
                <button type="button" className={buttonStyle} onClick={() => setTerminalTask('')}>
                  Fechar
                </button>
              </div>
              <Field label="Repositório do terminal">
                <select
                  className={inputStyle}
                  value={repositoryId}
                  onChange={(event) => setRepositoryId(event.target.value)}
                >
                  {selected.repositories.map((repo) => (
                    <option key={repo.id}>{repo.id}</option>
                  ))}
                </select>
              </Field>
              <Field label="Comando no sandbox">
                <textarea
                  className={`${inputStyle} font-mono`}
                  rows={3}
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                />
              </Field>
              <button className={buttonStyle} disabled={busy}>
                Executar comando
              </button>
              {terminalOutput && (
                <pre className="max-h-96 overflow-auto bg-paper p-4 font-mono text-xs whitespace-pre-wrap">
                  {terminalOutput}
                </pre>
              )}
            </form>
          )}
        </section>
      )}
      {view === 'previews' && !state.projects.length && (
        <p className="text-sm">
          Cadastre um{' '}
          <Link href="/projetos" className="underline">
            projeto
          </Link>{' '}
          para criar prévias.
        </p>
      )}
      {state.jobs.length > 0 && (
        <section className={panelStyle}>
          <h2 className="font-medium">Operações recentes</h2>
          <ul className="divide-y divide-rule">
            {state.jobs.slice(0, 12).map((job) => (
              <li key={job.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span>
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
                <span className={job.state === 'failed' ? 'text-fault' : 'text-ink-muted'}>
                  {stateLabel[job.state]}
                </span>
                <button
                  className={`${buttonStyle} ml-auto`}
                  onClick={() =>
                    void showLogs({ action: 'jobLogs', jobId: job.id }, `Operação · ${job.id}`)
                  }
                >
                  Ver saída
                </button>
                {job.error && (
                  <p className="w-full text-xs text-fault whitespace-pre-wrap">{job.error}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {log && (
        <section className={panelStyle}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">{log.title}</h2>
            <button className={buttonStyle} onClick={() => setLog(undefined)}>
              Fechar saída
            </button>
          </div>
          <pre className="max-h-[32rem] overflow-auto bg-paper p-4 font-mono text-xs whitespace-pre-wrap">
            {log.text}
          </pre>
        </section>
      )}
    </div>
  );
}

function NetworkSettings({
  state,
  save,
}: {
  state: RunnerState;
  save: (command: RunnerCommandInput) => Promise<void>;
}) {
  const [value, setValue] = useState(state.settings!);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await save({ action: 'saveSettings', definition: value, revision: state.settings!.revision });
      setMessage('Acesso atualizado. As próximas prévias usarão este endereço.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={panelStyle}
      aria-label="Acesso às prévias"
    >
      <h2 className="font-medium">Acesso às prévias</h2>
      <p className="text-sm text-ink-muted">
        Traefik compartilha uma porta e dá um endereço a cada serviço. Para usar no celular,
        habilite a rede local e informe o IP do computador seguido de .sslip.io, ou um domínio
        configurado no seu DNS.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Domínio das prévias">
          <input
            className={inputStyle}
            required
            value={value.domain}
            onChange={(event) =>
              setValue((current) => ({ ...current, domain: event.target.value }))
            }
            placeholder="192.168.1.10.sslip.io"
          />
        </Field>
        <Field label="Porta do Traefik">
          <input
            className={inputStyle}
            type="number"
            min="1024"
            max="65535"
            value={value.port}
            onChange={(event) =>
              setValue((current) => ({ ...current, port: Number(event.target.value) }))
            }
          />
        </Field>
        <Field label="Disponibilidade">
          <select
            className={inputStyle}
            value={value.bindAddress}
            onChange={(event) =>
              setValue((current) => ({
                ...current,
                bindAddress: event.target.value as '127.0.0.1' | '0.0.0.0',
              }))
            }
          >
            <option value="127.0.0.1">Somente neste computador</option>
            <option value="0.0.0.0">Rede local, incluindo celular</option>
          </select>
        </Field>
      </div>
      <button className={buttonStyle} disabled={busy}>
        Salvar acesso
      </button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </form>
  );
}
