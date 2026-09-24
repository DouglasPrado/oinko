'use client';
import { useState } from 'react';
import { GitBranch, Plus, Terminal, ExternalLink, Play, Square, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/shared/page-header';
import { cn } from '@/lib/utils/cn';
import { Blank, Status, listStyle } from './workspace-ui';
import { Field, inputStyle, slug, type RunnerState, type RunnerCommandInput } from './shared';
type Project = RunnerState['projects'][number];
export function WorkspaceTasks({
  state,
  project,
  environmentId,
  act,
  busy,
  showLogs,
}: {
  state: RunnerState;
  project: Project;
  environmentId?: string;
  act: (c: RunnerCommandInput, done?: string | false) => Promise<unknown>;
  busy: boolean;
  showLogs: (c: RunnerCommandInput, title: string) => Promise<void>;
}) {
  const [creating, setCreating] = useState(false),
    [name, setName] = useState(''),
    [branch, setBranch] = useState('');
  const [terminal, setTerminal] = useState(''),
    [repo, setRepo] = useState(project.repositories[0]?.id ?? ''),
    [command, setCommand] = useState('git status --short'),
    [output, setOutput] = useState('');
  const tasks = state.tasks.filter((t) => t.projectId === project.id);
  const pending =
    busy ||
    state.jobs.some((j) => j.projectId === project.id && ['queued', 'running'].includes(j.state));
  const trigger = (c: RunnerCommandInput, done?: string) => void act(c, done).catch(() => {});
  return (
    <div className="space-y-4">
      <SectionHeader
        title={environmentId ? 'Prévias por worktree' : 'Worktrees do projeto'}
        description={
          environmentId
            ? 'Escolha o trabalho que deseja testar neste ambiente.'
            : 'Cada tarefa tem sua branch e uma cópia de trabalho isolada.'
        }
        actions={
          <Button disabled={!project.environmentId} onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            Nova tarefa
          </Button>
        }
      />
      {!project.environmentId && (
        <p className="text-[13px] text-ink-muted">
          Adicione o primeiro ambiente para preparar as worktrees.
        </p>
      )}
      {!tasks.length ? (
        <Blank
          icon={<GitBranch />}
          title="Seu próximo trabalho começa aqui"
          description="Crie uma tarefa para preparar a branch. Depois, abra uma prévia para testar as alterações."
        />
      ) : (
        <div className={listStyle}>
          {tasks.map((task) => {
            const preview = state.previews.find(
              (p) => p.taskId === task.id && p.environmentId === environmentId,
            );
            // data-slot="card" continua sendo o contrato com os testes de ponta a
            // ponta, que localizam a tarefa por ele, mesmo sem o cartao visual.
            return (
              <article
                key={task.id}
                id={`tarefa-${task.id}`}
                data-slot="card"
                aria-label={task.name}
                className="space-y-3 px-4 py-3.5"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-rule text-ink-muted">
                      <GitBranch className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">{task.name}</h3>
                      <p
                        className="mt-0.5 truncate font-mono text-xs text-ink-muted"
                        title={task.branch}
                      >
                        {task.branch}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {environmentId && !preview && <Badge variant="outline">Sem prévia</Badge>}
                    <Status state={preview?.state ?? task.state} />
                  </div>
                </div>
                {(task.error || preview?.error) && (
                  <p
                    role="alert"
                    className="ml-11 rounded-lg border border-error/40 px-3 py-2 text-[13px] whitespace-pre-wrap text-error-ink"
                  >
                    {task.error || preview?.error}
                  </p>
                )}
                <div className="ml-11 flex flex-wrap items-center gap-2">
                  {environmentId && (
                    <Button
                      size="sm"
                      disabled={pending || task.state !== 'ready'}
                      onClick={() =>
                        trigger({ action: 'startPreview', taskId: task.id, environmentId })
                      }
                    >
                      <Play aria-hidden />
                      {preview?.state === 'ready' ? 'Reconstruir prévia' : 'Subir prévia'}
                    </Button>
                  )}
                  {preview && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || preview.state === 'stopped'}
                        onClick={() => trigger({ action: 'stopPreview', previewId: preview.id })}
                      >
                        <Square aria-hidden />
                        Parar prévia
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void showLogs(
                            { action: 'previewLogs', previewId: preview.id },
                            `Logs · ${task.name}`,
                          )
                        }
                      >
                        <ScrollText aria-hidden />
                        Logs dos serviços
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={task.state !== 'ready'}
                    onClick={() => {
                      setTerminal(task.id);
                      setOutput('');
                    }}
                  >
                    <Terminal aria-hidden />
                    Terminal
                  </Button>
                  {task.state === 'failed' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        trigger(
                          { action: 'createTask', definition: task },
                          'Preparando a worktree de novo',
                        )
                      }
                    >
                      Tentar preparar novamente
                    </Button>
                  )}
                </div>
                {preview?.state === 'ready' && (
                  <div className="ml-11 flex flex-wrap items-center gap-2 border-t border-rule pt-3">
                    {preview.urls.map((link) => (
                      <Button asChild size="sm" variant="secondary" key={link.serviceId}>
                        <a href={link.url} target="_blank" rel="noreferrer">
                          <ExternalLink aria-hidden />
                          Abrir {link.serviceId} ↗
                        </a>
                      </Button>
                    ))}
                    {!preview.urls.length && (
                      <Badge variant="secondary">Serviços sem rota de navegador</Badge>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova tarefa</DialogTitle>
            <DialogDescription>
              Prepare uma worktree nos repositórios de {project.name}.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const id = `${slug(name).slice(0, 32) || 'task'}-${crypto.randomUUID().slice(0, 6)}`;
              void act({
                action: 'createTask',
                definition: { id, name, branch: branch || `task/${id}`, projectId: project.id },
              })
                .then(() => {
                  setCreating(false);
                  setName('');
                  setBranch('');
                })
                .catch(() => {});
            }}
          >
            <Field label="Nome da tarefa">
              <Input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ajustar checkout"
              />
            </Field>
            <Field label="Branch" help="Deixe vazio para gerar uma branch exclusiva.">
              <Input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="task/ajustar-checkout"
              />
            </Field>
            <div className="-mx-6 -mb-6 flex justify-end gap-2 rounded-b-2xl border-t border-rule bg-paper px-6 py-3">
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancelar
              </Button>
              <Button disabled={busy} type="submit">
                Criar tarefa
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Sheet
        open={!!terminal}
        onOpenChange={(open) => {
          if (!open) setTerminal('');
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Terminal · {tasks.find((t) => t.id === terminal)?.name}</SheetTitle>
            <SheetDescription>Comandos executados no sandbox de {project.name}.</SheetDescription>
          </SheetHeader>
          <form
            className="space-y-4 px-6 py-6"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: 'shell', taskId: terminal, repositoryId: repo, command })
                .then((value) => {
                  const r = value as { stdout: string; stderr: string; exitCode: number };
                  setOutput(`${r.stdout}${r.stderr}\nCódigo de saída: ${r.exitCode}`);
                })
                .catch(() => {});
            }}
          >
            <Field label="Repositório do terminal">
              <select
                className={cn(inputStyle, 'font-mono')}
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              >
                {project.repositories.map((r) => (
                  <option key={r.id}>{r.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Comando no sandbox">
              <Textarea
                className="font-mono text-[13px]!"
                rows={4}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </Field>
            <Button disabled={busy}>
              <Terminal aria-hidden />
              Executar comando
            </Button>
            {output && (
              <pre
                aria-live="polite"
                className="overflow-auto rounded-lg border border-rule bg-paper p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink"
              >
                {output}
              </pre>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
