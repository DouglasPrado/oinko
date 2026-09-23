'use client';
import { useState } from 'react';
import { GitBranch, Plus, Terminal, ExternalLink, Play, Square, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Blank, Status } from './workspace-ui';
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
  act: (c: RunnerCommandInput) => Promise<unknown>;
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
  const trigger = (c: RunnerCommandInput) => void act(c).catch(() => {});
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {environmentId ? 'Prévias por worktree' : 'Worktrees do projeto'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {environmentId
              ? 'Escolha o trabalho que deseja testar neste ambiente.'
              : 'Cada tarefa tem sua branch e uma cópia de trabalho isolada.'}
          </p>
        </div>
        <Button disabled={!project.environmentId} onClick={() => setCreating(true)}>
          <Plus />
          Nova tarefa
        </Button>
      </div>
      {!project.environmentId && (
        <p className="text-sm text-muted-foreground">
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
        <div className="space-y-3">
          {tasks.map((task) => {
            const preview = state.previews.find(
              (p) => p.taskId === task.id && p.environmentId === environmentId,
            );
            return (
              <Card key={task.id} aria-label={task.name} className="py-0 shadow-none">
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <GitBranch className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium">{task.name}</h3>
                        <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                          {task.branch}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {environmentId && !preview && <Badge variant="outline">Sem prévia</Badge>}
                      <Status state={preview?.state ?? task.state} />
                    </div>
                  </div>
                  {(task.error || preview?.error) && (
                    <p role="alert" className="mt-4 text-sm text-destructive whitespace-pre-wrap">
                      {task.error || preview?.error}
                    </p>
                  )}
                  <div className="mt-5 flex flex-wrap gap-2">
                    {environmentId && (
                      <Button
                        disabled={pending || task.state !== 'ready'}
                        onClick={() =>
                          trigger({ action: 'startPreview', taskId: task.id, environmentId })
                        }
                      >
                        <Play />
                        {preview?.state === 'ready' ? 'Reconstruir prévia' : 'Subir prévia'}
                      </Button>
                    )}
                    {preview && (
                      <>
                        <Button
                          variant="outline"
                          disabled={pending || preview.state === 'stopped'}
                          onClick={() => trigger({ action: 'stopPreview', previewId: preview.id })}
                        >
                          <Square />
                          Parar prévia
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            void showLogs(
                              { action: 'previewLogs', previewId: preview.id },
                              `Logs · ${task.name}`,
                            )
                          }
                        >
                          <ScrollText />
                          Logs dos serviços
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      disabled={task.state !== 'ready'}
                      onClick={() => {
                        setTerminal(task.id);
                        setOutput('');
                      }}
                    >
                      <Terminal />
                      Terminal
                    </Button>
                    {task.state === 'failed' && (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => trigger({ action: 'createTask', definition: task })}
                      >
                        Tentar preparar novamente
                      </Button>
                    )}
                  </div>
                  {preview?.state === 'ready' && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                      {preview.urls.map((link) => (
                        <Button asChild variant="secondary" key={link.serviceId}>
                          <a href={link.url} target="_blank" rel="noreferrer">
                            <ExternalLink />
                            Abrir {link.serviceId} ↗
                          </a>
                        </Button>
                      ))}
                      {!preview.urls.length && (
                        <Badge variant="secondary">Serviços sem rota de navegador</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
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
            <Button disabled={busy} type="submit">
              Criar tarefa
            </Button>
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
            className="space-y-4 p-6"
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
              <select className={inputStyle} value={repo} onChange={(e) => setRepo(e.target.value)}>
                {project.repositories.map((r) => (
                  <option key={r.id}>{r.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Comando no sandbox">
              <Textarea
                className="font-mono"
                rows={4}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </Field>
            <Button disabled={busy}>Executar comando</Button>
            {output && (
              <pre
                aria-live="polite"
                className="overflow-auto rounded-lg bg-zinc-950 p-5 font-mono text-xs text-zinc-100 whitespace-pre-wrap"
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
