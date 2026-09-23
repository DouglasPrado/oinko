import { z } from 'zod';
import type { AgentTool } from '@oinko/agent-runtime';
import { EnvironmentClient, type RunnerCommandInput } from '@oinko/environments/client';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const location = { taskId: id, repositoryId: id };
export const PROGRAMMING_INSTRUCTIONS =
  '\nVocê pode programar nos projetos autorizados usando workspace_status, workspace_task, workspace_exec, workspace_read, workspace_write e workspace_preview. Comece consultando workspace_status. Crie uma tarefa/worktree e aguarde seu job concluir antes de editar. Todos os comandos e arquivos devem passar por essas ferramentas de sandbox. Builds e prévias são operações assíncronas: consulte workspace_status e workspace_logs para acompanhar; não diga que estão prontos antes de confirmar. Preserve alterações existentes. Use Git dentro da worktree para inspecionar e organizar mudanças.';

export function programmingTools(root: string, botId: string): AgentTool[] {
  const client = new EnvironmentClient(root, botId);
  function tool(
    name: string,
    description: string,
    parameters: z.ZodType,
    command: (args: unknown) => RunnerCommandInput,
    readOnly = false,
  ): AgentTool {
    return {
      name,
      description,
      parameters,
      isReadOnly: readOnly,
      isConcurrencySafe: readOnly,
      untrustedOutput: true,
      timeoutMs: 660_000,
      execute: async (args) =>
        JSON.stringify(await client.command(command(parameters.parse(args)))),
    };
  }
  const task = z.object({ projectId: id, id, name: z.string().min(1), branch: z.string().min(1) });
  const shell = z.object({
    ...location,
    command: z.string().min(1),
    timeoutSeconds: z.number().int().min(1).max(600).default(120),
  });
  const read = z.object({ ...location, path: z.string().min(1) });
  const write = read.extend({ content: z.string().max(200_000) });
  const preview = z.object({ taskId: id, action: z.enum(['start', 'stop']) });
  const logs = z.object({ kind: z.enum(['job', 'preview']), id });
  return [
    tool(
      'workspace_status',
      'Lista projetos autorizados, tarefas, prévias e operações. Consulte para confirmar se um job terminou.',
      z.object({}),
      () => ({ action: 'state' }),
      true,
    ),
    tool(
      'workspace_task',
      'Cria uma tarefa com branch e worktree em cada repositório do projeto. Retorna um job assíncrono.',
      task,
      (args) => ({ action: 'createTask', definition: task.parse(args) }),
    ),
    tool(
      'workspace_exec',
      'Executa terminal, Git, instalações e testes dentro do container do projeto e da worktree escolhida.',
      shell,
      (args) => ({ action: 'shell', ...shell.parse(args) }),
    ),
    tool(
      'workspace_read',
      'Lê até 200 KB de um arquivo relativo à worktree, dentro do sandbox.',
      read,
      (args) => ({ action: 'readFile', ...read.parse(args) }),
      true,
    ),
    tool(
      'workspace_write',
      'Cria ou substitui um arquivo relativo à worktree, dentro do sandbox.',
      write,
      (args) => ({ action: 'writeFile', ...write.parse(args) }),
    ),
    tool(
      'workspace_preview',
      'Solicita iniciar ou parar a prévia de uma tarefa. Acompanhe o job até concluir.',
      preview,
      (args) => {
        const value = preview.parse(args);
        return value.action === 'start'
          ? { action: 'startPreview', taskId: value.taskId }
          : { action: 'stopPreview', previewId: value.taskId };
      },
    ),
    tool(
      'workspace_logs',
      'Lê logs de uma operação ou dos serviços de uma prévia.',
      logs,
      (args) => {
        const value = logs.parse(args);
        return value.kind === 'job'
          ? { action: 'jobLogs', jobId: value.id }
          : { action: 'previewLogs', previewId: value.id };
      },
      true,
    ),
  ];
}
