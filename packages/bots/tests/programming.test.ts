import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { EnvironmentClient } from '@oinko/environments/client';
import { createAgentHost } from '@oinko/agent-runtime';
import { startEnvironmentService } from '@oinko/environments';
import { programmingTools } from '../src/programming-tools.js';

async function scriptedProgrammingTurn(root: string, drain: () => Promise<void>) {
  const location = { taskId: 'loop', repositoryId: 'app' };
  const steps = [
    { name: 'workspace_status', args: {} },
    {
      name: 'workspace_task',
      args: { projectId: 'project', id: 'loop', name: 'Loop', branch: 'task/loop' },
    },
    { name: 'workspace_status', args: {} },
    {
      name: 'workspace_write',
      args: { ...location, path: 'from-agent.txt', content: 'agent-loop-content' },
    },
    { name: 'workspace_read', args: { ...location, path: 'from-agent.txt' } },
    {
      name: 'workspace_exec',
      args: {
        ...location,
        command: 'git add . && git commit -m agent-loop && git branch --show-current',
      },
    },
    { name: 'workspace_preview', args: { action: 'start', taskId: 'loop' } },
    { name: 'workspace_status', args: {} },
    { name: 'workspace_logs', args: { kind: 'preview', id: 'loop' } },
    { name: 'workspace_preview', args: { action: 'stop', previewId: 'loop' } },
    { name: 'workspace_status', args: {} },
  ];
  let index = 0;
  const results: Record<string, unknown>[] = [];
  const host = createAgentHost({
    id: 'coder',
    dataDir: join(root, 'scripted-agent'),
    telemetryDbPath: join(root, 'agent-telemetry.db'),
    telemetryEnabled: false,
    capturePayloads: 'none',
    retentionDays: 1,
    tools: programmingTools(root, 'coder'),
    agent: {
      apiKey: 'fixture',
      model: 'openai/gpt-4o-mini',
      maxIterations: 20,
      memory: { enabled: false },
      knowledge: { enabled: false },
      fetch: async (request: Request) => {
        // Only the model is scripted; the actual Agent loop calls every tool through the socket.
        // Let each asynchronous job finish before the model's next status query.
        await drain();
        const body = (await request.json()) as { messages: { role: string; content: string }[] };
        if (index > 0)
          results.push(JSON.parse(body.messages.filter((m) => m.role === 'tool').at(-1)!.content));
        const step = steps[index++];
        const frames = step
          ? [
              {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: `sandbox-call-${index}`,
                          function: { name: step.name, arguments: JSON.stringify(step.args) },
                        },
                      ],
                    },
                    index: 0,
                  },
                ],
              },
              { choices: [{ finish_reason: 'tool_calls', index: 0 }] },
            ]
          : [
              { choices: [{ delta: { content: 'Sandbox verificado.' }, index: 0 }] },
              { choices: [{ finish_reason: 'stop', index: 0 }] },
            ];
        return new Response(
          frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    },
  });
  try {
    expect(
      await host.agent.chat(
        'Crie uma tarefa, altere e confira um arquivo, faça commit e teste e pare a prévia.',
      ),
    ).toBe('Sandbox verificado.');
    expect(results).toHaveLength(steps.length);
    expect(results[4]).toEqual({ text: 'agent-loop-content' });
    expect(results[5]?.stdout).toContain('task/loop');
    expect(results[8]?.text).toContain('bot-preview-ready');
    expect(results[10]?.previews).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'loop', state: 'stopped' })]),
    );
  } finally {
    await host.close();
  }
}

it('registers programming tools in the real agent loop and scopes the result to the authorized bot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oinko-tool-loop-'));
  const service = await startEnvironmentService(root);
  await service.controller.handle({
    command: { action: 'saveEnvironment', definition: { id: 'node', name: 'Node' }, revision: 0 },
  });
  for (const id of ['allowed', 'private'])
    await service.controller.handle({
      command: {
        action: 'saveProject',
        revision: 0,
        definition: {
          id,
          name: id,
          environmentId: 'node',
          repositories: [{ id: 'app', source: 'https://example.com/app.git' }],
          allowedBotIds: id === 'allowed' ? ['coder'] : [],
        },
      },
    });
  let requests = 0;
  let returnedProjects: unknown;
  let exposedTools: string[] = [];
  const host = createAgentHost({
    id: 'coder',
    dataDir: join(root, 'bot'),
    telemetryDbPath: join(root, 'telemetry.db'),
    telemetryEnabled: false,
    capturePayloads: 'none',
    retentionDays: 1,
    tools: programmingTools(root, 'coder'),
    agent: {
      apiKey: 'fixture',
      model: 'openai/gpt-4o-mini',
      memory: { enabled: false },
      knowledge: { enabled: false },
      fetch: async (request: Request) => {
        const body = (await request.json()) as {
          tools: { function: { name: string } }[];
          messages: { role: string; content: string }[];
        };
        exposedTools = body.tools.map((tool) => tool.function.name);
        let frames: unknown[];
        if (requests++ === 0)
          frames = [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call-workspace',
                        function: { name: 'workspace_status', arguments: '{}' },
                      },
                    ],
                  },
                  index: 0,
                },
              ],
            },
            { choices: [{ finish_reason: 'tool_calls', index: 0 }] },
          ];
        else {
          const toolResult = [...body.messages]
            .reverse()
            .find((message) => message.role === 'tool');
          returnedProjects = JSON.parse(toolResult!.content).projects;
          frames = [
            { choices: [{ delta: { content: 'Projeto autorizado disponível.' }, index: 0 }] },
            { choices: [{ finish_reason: 'stop', index: 0 }] },
          ];
        }
        return new Response(
          frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      },
    },
  });
  try {
    expect(await host.agent.chat('Liste meus projetos autorizados.')).toContain(
      'Projeto autorizado',
    );
    expect(exposedTools).toEqual(
      expect.arrayContaining([
        'workspace_status',
        'workspace_task',
        'workspace_read',
        'workspace_write',
        'workspace_exec',
        'workspace_preview',
        'workspace_logs',
      ]),
    );
    expect(returnedProjects).toEqual([expect.objectContaining({ id: 'allowed' })]);
  } finally {
    await host.close();
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it.skipIf(process.env.OINKO_DOCKER_TEST !== '1')(
  'lets a bot create multi-repository worktrees, edit code, commit and enforce project boundaries in Docker',
  async () => {
    const root = mkdtempSync(join(tmpdir(), 'oinko-programming-'));
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'message.txt'), 'original');
    const git = (args: string[]) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
    git(['init', '-b', 'main']);
    git(['add', '.']);
    git(['-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'fixture']);
    const service = await startEnvironmentService(root);
    const tools = programmingTools(root, 'coder');
    const call = async (name: string, args: unknown) =>
      JSON.parse(
        String(
          await tools
            .find((tool) => tool.name === name)!
            .execute(args, new AbortController().signal),
        ),
      );
    try {
      await service.controller.handle({
        command: {
          action: 'saveEnvironment',
          definition: { id: 'node', name: 'Node' },
          revision: 0,
        },
      });
      await service.controller.handle({
        command: {
          action: 'saveProject',
          revision: 0,
          definition: {
            id: 'project',
            name: 'Project',
            environmentId: 'node',
            repositories: [
              { id: 'app', source },
              { id: 'api', source },
            ],
            allowedBotIds: ['coder'],
          },
        },
      });
      await call('workspace_task', {
        projectId: 'project',
        id: 'change',
        name: 'Change',
        branch: 'task/change',
      });
      await service.controller.drain();
      expect(service.controller.workspaces.task('change').state).toBe('ready');
      const location = { taskId: 'change', repositoryId: 'app' };
      await call('workspace_write', { ...location, path: 'nested/hello.txt', content: 'from-bot' });
      expect(await call('workspace_read', { ...location, path: 'nested/hello.txt' })).toEqual({
        text: 'from-bot',
      });
      // The bot's preview and log tools cross the same socket as its Git/file tools.
      const environment = service.controller.environments.environment('node');
      const recipe = {
        ...environment,
        services: [
          {
            id: 'worker',
            image: 'node:22-alpine',
            command: 'echo bot-preview-ready; sleep infinity',
          },
        ],
      };
      service.controller.environments.saveEnvironment(recipe, {}, environment.revision);
      service.controller.environments.saveEnvironment(
        { ...recipe, id: 'review', name: 'Review' },
        {},
        0,
      );
      const project = service.controller.workspaces.project('project');
      service.controller.workspaces.saveProject(
        { ...project, environmentIds: ['review'] },
        project.revision,
      );
      await scriptedProgrammingTurn(root, () => service.controller.drain());
      for (const environmentId of ['node', 'review']) {
        const job = await call('workspace_preview', {
          action: 'start',
          taskId: 'change',
          environmentId,
        });
        await service.controller.drain();
        const state = await call('workspace_status', {});
        expect(state.jobs.find((item: { id: string }) => item.id === job.id)?.state).toBe(
          'succeeded',
        );
        const preview = state.previews.find(
          (item: { environmentId: string; taskId: string }) =>
            item.environmentId === environmentId && item.taskId === 'change',
        );
        expect(preview.state).toBe('ready');
        expect((await call('workspace_logs', { kind: 'preview', id: preview.id })).text).toContain(
          'bot-preview-ready',
        );
        expect((await call('workspace_logs', { kind: 'job', id: job.id })).text).toContain(
          'Started',
        );
      }
      const previews = service.controller.environments
        .previews()
        .filter((preview) => preview.taskId === 'change');
      expect(new Set(previews.map((preview) => preview.id)).size).toBe(2);
      for (const preview of previews) {
        await call('workspace_preview', { action: 'stop', previewId: preview.id });
        await service.controller.drain();
        expect(service.controller.environments.preview(preview.id).state).toBe('stopped');
      }
      expect(
        (
          await call('workspace_exec', {
            ...location,
            command: 'git add . && git commit -m changed && git branch --show-current',
          })
        ).stdout,
      ).toContain('task/change');
      expect(
        (
          await call('workspace_exec', {
            ...location,
            repositoryId: 'api',
            command: 'git branch --show-current',
          })
        ).stdout.trim(),
      ).toBe('task/change');
      expect(readFileSync(join(source, 'message.txt'), 'utf8')).toBe('original');
      expect(
        (await call('workspace_exec', { ...location, command: 'sleep 10', timeoutSeconds: 1 }))
          .exitCode,
      ).not.toBe(0);
      await expect(
        call('workspace_read', { ...location, path: '../repositories/app/config' }),
      ).rejects.toThrow();
      const intruder = programmingTools(root, 'intruder').find(
        (tool) => tool.name === 'workspace_exec',
      )!;
      await expect(
        intruder.execute({ ...location, command: 'pwd' }, new AbortController().signal),
      ).rejects.toThrow(/autorizad/);
      await service.controller.handle({ command: { action: 'stopSandbox', projectId: 'project' } });
      await service.controller.drain();
      expect(await call('workspace_read', { ...location, path: 'nested/hello.txt' })).toEqual({
        text: 'from-bot',
      });
    } finally {
      for (const preview of service.controller.environments.previews())
        await service.controller.previews.stop(preview.id).catch(() => {});
      await service.controller.sandbox.stop('project');
      await service.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);

it('routes preview tools to the selected environment and stops by preview identity', async () => {
  const command = vi.spyOn(EnvironmentClient.prototype, 'command').mockResolvedValue({ id: 'job' });
  try {
    const tool = programmingTools('/unused-test-root', 'dev').find(
      (tool) => tool.name === 'workspace_preview',
    )!;
    const signal = new AbortController().signal;
    await tool.execute({ action: 'start', taskId: 'task', environmentId: 'review' }, signal);
    expect(command).toHaveBeenLastCalledWith({
      action: 'startPreview',
      taskId: 'task',
      environmentId: 'review',
    });
    await tool.execute({ action: 'stop', previewId: 'review-preview' }, signal);
    expect(command).toHaveBeenLastCalledWith({
      action: 'stopPreview',
      previewId: 'review-preview',
    });
    await tool.execute({ action: 'stop', taskId: 'legacy-task' }, signal);
    expect(command).toHaveBeenLastCalledWith({ action: 'stopPreview', previewId: 'legacy-task' });
    await expect(
      tool.execute({ action: 'start', environmentId: 'review' }, signal),
    ).rejects.toThrow(/taskId/);
  } finally {
    command.mockRestore();
  }
});
