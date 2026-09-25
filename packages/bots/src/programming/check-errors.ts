// Terminal colors: built from the escape character so the pattern carries no control character.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const SOURCE = /^\s*(\S+\.(?:[cm]?[jt]sx?|css|json|vue|svelte))\s*$/;

/** Sandbox paths as tools print them, made relative to where the check ran. */
function relative(path: string, cwd: string): string {
  let value = path.replace(/^\/workspace\/tasks\/[^/]+\/[^/]+\//, '');
  const base = cwd.replace(/^\.\/?/, '').replace(/\/$/, '');
  if (base && value.startsWith(`${base}/`)) value = value.slice(base.length + 1);
  return value;
}

/**
 * The lines of a failed check that say what to fix (TypeScript, ESLint and
 * Vitest formats), each tied to its file, without colors or stack frames:
 * what a model acts on without reading the whole log.
 */
export function errorLines(log: string, cwd = '.'): string[] {
  const found: string[] = [];
  let file: string | undefined;
  for (const raw of log.replace(ANSI, '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.includes('node_modules')) continue;
    const source = SOURCE.exec(line);
    if (source) {
      file = relative(source[1]!, cwd);
      continue;
    }
    const lint = /^\s*(\d+):(\d+)\s+error\s+(.+)$/.exec(line);
    if (lint && file) {
      found.push(`${file}:${lint[1]}:${lint[2]} error ${lint[3]!.replace(/\s{2,}/g, ' ').trim()}`);
      continue;
    }
    if (/error TS\d+:/.test(line)) {
      found.push(relative(line.trim(), cwd));
      continue;
    }
    const failed = /^\s*FAIL\s+(\S+)/.exec(line);
    if (failed) {
      found.push(`FAIL ${relative(failed[1]!, cwd)}`);
      continue;
    }
    const error = /^\s*(\w*Error): (.+)$/.exec(line);
    if (error) found.push(`${error[1]}: ${error[2]!.trim()}`);
  }
  return [...new Set(found)].slice(0, 12).map((item) => item.slice(0, 300));
}
