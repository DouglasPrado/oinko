import { expect, it } from 'vitest';
import { errorLines } from '../src/programming/check-errors.js';

// Excerpts of real check logs from a dashboard run (paths kept, noise trimmed).
const TYPECHECK = `> @oinko/dashboard@0.1.0 typecheck /workspace/tasks/dark-ui/oinko/apps/dashboard
> tsc --noEmit
src/components/shell/workbench.test.tsx(3,24): error TS2307: Cannot find module '../../../../tests/helpers/render' or its corresponding type declarations.
tests/helpers/match-media.ts(19,9): error TS2739: Type '{ matches: boolean; }' is missing the following properties from type 'MediaQueryList': dispatchEvent
 ELIFECYCLE  Command failed with exit code 2.`;
const LINT = `> eslint .

/workspace/tasks/dark-ui/oinko/apps/dashboard/src/components/shared/theme-toggle.test.tsx
  25:3  error  Unsafe call of a type that could not be resolved  @typescript-eslint/no-unsafe-call
  38:3  error  Unsafe call of a type that could not be resolved  @typescript-eslint/no-unsafe-call

✖ 2 problems (2 errors, 0 warnings)`;
const VITEST = `\u001b[31m⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯\u001b[39m
\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m src/components/shell/workbench.test.tsx [ src/components/shell/workbench.test.tsx ]
\u001b[31m\u001b[1mError\u001b[22m: Failed to resolve import "../../../../tests/helpers/render" from "src/components/shell/workbench.test.tsx". Does the file exist?\u001b[39m
 ❯ TransformPluginContext.error ../../node_modules/.pnpm/vite@8.3.0/node_modules/vite/dist/node/chunks/node.js:8390:14
 Test Files  1 failed | 11 passed (12)`;

it('keeps the lines that say what to fix, with the file they are about', () => {
  expect(errorLines(TYPECHECK)).toEqual([
    "src/components/shell/workbench.test.tsx(3,24): error TS2307: Cannot find module '../../../../tests/helpers/render' or its corresponding type declarations.",
    "tests/helpers/match-media.ts(19,9): error TS2739: Type '{ matches: boolean; }' is missing the following properties from type 'MediaQueryList': dispatchEvent",
  ]);
  expect(errorLines(LINT, 'apps/dashboard')).toEqual([
    'src/components/shared/theme-toggle.test.tsx:25:3 error Unsafe call of a type that could not be resolved @typescript-eslint/no-unsafe-call',
    'src/components/shared/theme-toggle.test.tsx:38:3 error Unsafe call of a type that could not be resolved @typescript-eslint/no-unsafe-call',
  ]);
  const vitest = errorLines(VITEST);
  expect(vitest[0]).toBe('FAIL src/components/shell/workbench.test.tsx');
  expect(vitest[1]).toMatch(/^Error: Failed to resolve import "\.\.\/\.\.\/\.\.\/\.\.\/tests\/helpers\/render"/);
  expect(vitest.join('\n')).not.toContain(String.fromCharCode(27));
  expect(vitest.join('\n')).not.toContain('node_modules');
});

it('stays short on a huge log', () => {
  const log = Array.from({ length: 500 }, (_, index) => `src/a${index}.ts(1,1): error TS1000: bad`).join('\n');
  expect(errorLines(log)).toHaveLength(12);
});
