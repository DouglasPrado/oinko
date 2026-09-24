'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { listStyle } from '@/features/projects/workspace-ui';
import { programmingRequest, RUN_STATE_LABEL } from './api';

interface Tree {
  botId: string;
  projects: { projectId: string; tasks: { taskId: string; runs: Record<string, number> }[] }[];
}

/** bot → projeto → tarefa → runs: onde está cada trabalho da instalação. */
export function RunTree() {
  const tree = useQuery({
    queryKey: ['run-tree'],
    queryFn: () => programmingRequest<Tree[]>('/api/runs/tree'),
    refetchInterval: 5000,
  });
  if (!tree.data?.length) return null;
  return (
    <section aria-label="Árvore de trabalhos" className={listStyle}>
      {tree.data.map((bot) => (
        <div key={bot.botId} className="px-4 py-3">
          <Link href={`/bots/${encodeURIComponent(bot.botId)}/trabalhos`} className="text-sm font-medium text-ink hover:underline">
            {bot.botId}
          </Link>
          <ul className="mt-1.5 space-y-1 pl-3 text-xs text-ink-muted">
            {bot.projects.map((project) => (
              <li key={project.projectId}>
                <span className="font-mono text-ink">{project.projectId}</span>
                <ul className="pl-3">
                  {project.tasks.map((task) => (
                    <li key={task.taskId}>
                      <span className="font-mono">{task.taskId === '-' ? 'sem tarefa' : task.taskId}</span>:{' '}
                      {Object.entries(task.runs)
                        .map(([state, count]) => `${count} ${RUN_STATE_LABEL[state]?.toLowerCase() ?? state}`)
                        .join(', ')}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
