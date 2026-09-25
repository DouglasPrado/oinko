import { expect, it } from 'vitest';
import { hiddenToolsFor } from '../src/programming/hidden-tools.js';

const names = (list: { name: string }[]) => list.map((item) => item.name);
const run = (policy: Record<string, unknown>, taskId?: string) => ({ taskId, request: { mode: 'change' }, policySnapshot: { policy } }) as never;

it('offers a cycle only the tools its run policy lets it use', () => {
  const hidden = hiddenToolsFor(run({ allowEdits: true, allowBrowser: false, allowPublication: false }, 'dark-ui'));
  const restricted = names(hidden);
  for (const name of ['browser_open', 'browser_click', 'functional_check', 'publication_publish', 'publication_ci', 'workspace_prepare_task'])
    expect(restricted, name).toContain(name);
  // A preview is how the person sees a visible change: it never depended on the browser.
  for (const name of ['workspace_read_range', 'workspace_patch', 'workspace_check', 'workspace_exec', 'workspace_preview', 'programming_complete']) expect(restricted, name).not.toContain(name);
  expect(hiddenToolsFor(run({ allowEdits: true, allowBrowser: true, allowPublication: true }))).toEqual([]);
  // What the policy refuses is marked, so a call anyway still counts as a denial.
  expect(hidden.find((item) => item.name === 'publication_publish')).toEqual({ name: 'publication_publish', denied: 'publish' });
  expect(hidden.find((item) => item.name === 'workspace_prepare_task')).toEqual({ name: 'workspace_prepare_task' });
  // Analysis runs never edit: the edit tools are not offered either.
  expect(names(hiddenToolsFor(run({ allowEdits: false, allowBrowser: true, allowPublication: false }, 't')))).toEqual(expect.arrayContaining(['workspace_replace', 'workspace_patch']));
});
