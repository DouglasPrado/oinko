import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createAgentHost } from '@oinko/agent-runtime';
import { startEnvironmentService } from '@oinko/environments';
import { programmingTools } from '../src/programming-tools.js';

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
      await service.controller.sandbox.stop('project');
      await service.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
