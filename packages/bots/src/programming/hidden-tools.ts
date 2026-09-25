import type { ProgrammingRun } from '@oinko/agent-runtime/programming';

const BROWSER = ['workspace_preview', 'browser_open', 'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_wait', 'browser_screenshot', 'browser_diagnostics', 'browser_close', 'functional_check'];
const PUBLICATION = ['publication_review', 'publication_publish', 'publication_ci'];
const EDITS = ['workspace_replace', 'workspace_patch'];

/**
 * Tools a cycle of this run is not offered: the ones its policy refuses
 * anyway (browser, publication, edits in an analysis) and task preparation
 * once the task exists. Fewer, usable tools keep a smaller model from
 * trying what can only fail.
 */
export function hiddenToolsFor(run: Pick<ProgrammingRun, 'taskId' | 'policySnapshot'>): { name: string; denied?: 'browser' | 'publish' | 'mutate' }[] {
  const policy = run.policySnapshot.policy as { allowEdits?: boolean; allowBrowser?: boolean; allowPublication?: boolean };
  // `denied`: the policy refuses it, so a call anyway is a safety incident, not just an unknown tool.
  return [
    ...(policy.allowBrowser ? [] : BROWSER.map((name) => ({ name, denied: 'browser' as const }))),
    ...(policy.allowPublication ? [] : PUBLICATION.map((name) => ({ name, denied: 'publish' as const }))),
    ...(policy.allowEdits === false ? EDITS.map((name) => ({ name, denied: 'mutate' as const })) : []),
    ...(run.taskId ? [{ name: 'workspace_prepare_task' }] : []),
  ];
}
