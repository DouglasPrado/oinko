/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Workspace operations that run *inside* the project sandbox.
 *
 * `workspaceOps` must stay self-contained: it is serialized with
 * `Function.prototype.toString()` and executed by `node -e` in the container,
 * so it may only use the modules passed in `deps` — never outer-scope values.
 * Unit tests call it directly on a temporary directory.
 */
export interface OpsDeps {
  fs: typeof import('node:fs');
  path: typeof import('node:path');
  crypto: typeof import('node:crypto');
  child: typeof import('node:child_process');
}

export interface OpsError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

export function workspaceOps(request: any, deps: OpsDeps): any {
  const { fs, path, crypto, child } = deps;
  const root: string = fs.realpathSync(request.root ?? process.cwd());
  const fail = (code: string, message: string, details?: Record<string, unknown>) => {
    const error: any = new Error(message);
    error.opsCode = code;
    error.details = details;
    throw error;
  };
  const sha = (data: Buffer | string) => `sha256:${crypto.createHash('sha256').update(data).digest('hex')}`;
  const inside = (candidate: string) => candidate === root || candidate.startsWith(root + path.sep);
  const GENERATED = [
    /(^|\/)(dist|build|out|coverage|\.next|\.nuxt|\.turbo|\.cache|\.parcel-cache|target|vendor)\//,
    /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|composer\.lock)$/,
    /\.min\.(js|css)$/,
    /\.map$/,
  ];
  const ALWAYS_SKIP = /(^|\/)(\.git|node_modules)(\/|$)/;

  /** Resolves a relative path, refusing escapes through `..` or symlinks. */
  function resolve(relative: string, mustExist: boolean): { absolute: string; exists: boolean } {
    if (!relative || relative.startsWith('/') || relative.includes('\0') || relative.split('/').includes('..'))
      fail('invalid_path', 'Use um caminho relativo dentro da worktree.');
    const absolute = path.resolve(root, relative);
    if (!inside(absolute)) fail('invalid_path', 'Caminho fora da worktree.');
    if (absolute === root) return { absolute, exists: true };
    // Every existing ancestor must resolve inside the root.
    let cursor = root;
    for (const part of path.relative(root, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
      cursor = path.join(cursor, part);
      if (!fs.existsSync(cursor)) break;
      if (!inside(fs.realpathSync(cursor))) fail('symlink_escape', 'Symlink aponta para fora da worktree.');
    }
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) {
      if (mustExist) fail('not_found', `Arquivo não encontrado: ${relative}`);
      return { absolute, exists: false };
    }
    if (stat.isSymbolicLink()) {
      let real: string;
      try {
        real = fs.realpathSync(absolute);
      } catch {
        return fail('symlink_escape', 'Symlink quebrado ou fora da worktree.');
      }
      if (!inside(real)) fail('symlink_escape', 'Symlink aponta para fora da worktree.');
    }
    return { absolute, exists: true };
  }

  function git(args: string[], env: Record<string, string> = {}): string {
    return child.execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    });
  }

  function isBinary(buffer: Buffer): boolean {
    const length = Math.min(buffer.length, 8000);
    for (let i = 0; i < length; i++) if (buffer[i] === 0) return true;
    return false;
  }

  function globToRegex(glob: string): RegExp {
    let out = '';
    let i = 0;
    while (i < glob.length) {
      const c = glob[i]!;
      if (c === '*') {
        if (glob[i + 1] === '*') {
          out += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
          i += glob[i + 2] === '/' ? 3 : 2;
          continue;
        }
        out += '[^/]*';
      } else if (c === '?') out += '[^/]';
      else if (c === '{') {
        const end = glob.indexOf('}', i);
        if (end > i) {
          out += `(?:${glob
            .slice(i + 1, end)
            .split(',')
            .map((part) => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
            .join('|')})`;
          i = end + 1;
          continue;
        }
        out += '\\{';
      } else out += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
      i++;
    }
    return new RegExp(`^${out}$`);
  }

  /** Candidate files in stable order, with what was excluded and why. */
  function listFiles(options: any): { files: string[]; excluded: Record<string, number> } {
    const excluded: Record<string, number> = { ignored: 0, generated: 0, symlink: 0, filter: 0 };
    let files: string[];
    if (options.includeIgnored) {
      files = [];
      const walk = (directory: string) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
          const absolute = path.join(directory, entry.name);
          const relative = path.relative(root, absolute).split(path.sep).join('/');
          if (entry.name === '.git') continue;
          if (entry.isSymbolicLink()) {
            let real: string;
            try {
              real = fs.realpathSync(absolute);
            } catch {
              excluded.symlink!++;
              continue;
            }
            if (!inside(real) || fs.statSync(absolute).isDirectory()) {
              excluded.symlink!++;
              continue;
            }
            files.push(relative);
          } else if (entry.isDirectory()) walk(absolute);
          else if (entry.isFile()) files.push(relative);
        }
      };
      walk(root);
    } else {
      files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .split('\0')
        .filter(Boolean);
      files = [...new Set(files)].sort();
      const tracked = files.filter((file) => {
        const absolute = path.join(root, file);
        const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat) return false; // deleted in the worktree
        if (stat.isSymbolicLink()) {
          try {
            const real = fs.realpathSync(absolute);
            if (!inside(real) || fs.statSync(real).isDirectory()) {
              excluded.symlink!++;
              return false;
            }
          } catch {
            excluded.symlink!++;
            return false;
          }
        }
        return !stat.isDirectory();
      });
      files = tracked;
    }
    files = files.filter((file) => {
      if (ALWAYS_SKIP.test(file) && !options.includeIgnored) {
        excluded.ignored!++;
        return false;
      }
      if (!options.includeGenerated && GENERATED.some((pattern) => pattern.test(file))) {
        excluded.generated!++;
        return false;
      }
      return true;
    });
    const prefix = options.path && options.path !== '.' ? `${options.path.replace(/\/$/, '')}/` : '';
    const glob = options.glob ? globToRegex(options.glob) : undefined;
    const before = files.length;
    files = files.filter((file) => (!prefix || file.startsWith(prefix)) && (!glob || glob.test(file)));
    excluded.filter = before - files.length;
    return { files, excluded };
  }

  function cursorOf(value: string | undefined): number {
    if (!value) return 0;
    const parsed = Number.parseInt(Buffer.from(value, 'base64url').toString('utf8'), 10);
    if (!Number.isFinite(parsed) || parsed < 0) fail('invalid_cursor', 'Cursor de paginação inválido.');
    return parsed;
  }
  const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString('base64url');

  function decode(buffer: Buffer): string | undefined {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return undefined;
    }
  }

  function splitLines(text: string): string[] {
    const lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  }

  function treeHash(): string {
    const index = path.join(require_tmp(), `oinko-index-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    try {
      const env = { GIT_INDEX_FILE: index };
      try {
        git(['read-tree', 'HEAD'], env);
      } catch {
        /* unborn branch: start from an empty index */
      }
      git(['add', '-A', '--', '.'], env);
      return `tree:${git(['write-tree'], env).trim()}`;
    } finally {
      fs.rmSync(index, { force: true });
      fs.rmSync(`${index}.lock`, { force: true });
    }
  }
  function require_tmp(): string {
    const directory = process.env.TMPDIR || '/tmp';
    return fs.existsSync(directory) ? directory : root;
  }

  function writeAtomic(absolute: string, data: string | Buffer, mode?: number) {
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temporary = `${absolute}.oinko-${process.pid}-${Math.random().toString(16).slice(2)}`;
    fs.writeFileSync(temporary, data, mode === undefined ? undefined : { mode });
    fs.renameSync(temporary, absolute);
  }

  function count(haystack: string, needle: string): number {
    let total = 0;
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      total++;
      at = haystack.indexOf(needle, at + needle.length);
    }
    return total;
  }

  /** Validates one edit against the file as it is now; returns the new content. */
  function plan(edit: any): any {
    const target = resolve(edit.path, edit.action !== 'create');
    if (edit.action === 'create') {
      if (target.exists) return { path: edit.path, ok: false, code: 'exists', message: 'O arquivo já existe; use replace.' };
      return { path: edit.path, ok: true, action: 'create', beforeHash: 'absent', afterHash: sha(edit.content), content: edit.content };
    }
    const stat = fs.statSync(target.absolute);
    if (!stat.isFile()) return { path: edit.path, ok: false, code: 'not_a_file', message: 'Não é um arquivo regular.' };
    const buffer = fs.readFileSync(target.absolute);
    const beforeHash = sha(buffer);
    if (beforeHash !== edit.expectedHash)
      return { path: edit.path, ok: false, code: 'stale', message: 'O arquivo mudou desde a leitura; leia novamente.', currentHash: beforeHash };
    if (edit.action === 'delete') return { path: edit.path, ok: true, action: 'delete', beforeHash, afterHash: 'absent', mode: stat.mode };
    if (isBinary(buffer)) return { path: edit.path, ok: false, code: 'binary_file', message: 'Arquivo binário não é editável por texto.' };
    const text = decode(buffer);
    if (text === undefined) return { path: edit.path, ok: false, code: 'unsupported_encoding', message: 'Arquivo não é UTF-8.' };
    const occurrences = count(text, edit.oldText);
    if (occurrences === 0) return { path: edit.path, ok: false, code: 'no_match', message: 'Trecho não encontrado exatamente.' };
    if (occurrences > 1 && !edit.replaceAll)
      return { path: edit.path, ok: false, code: 'ambiguous', message: `Trecho aparece ${occurrences} vezes; torne-o único ou use replaceAll.`, occurrences };
    const content = edit.replaceAll ? text.split(edit.oldText).join(edit.newText) : text.replace(edit.oldText, () => edit.newText);
    return { path: edit.path, ok: true, action: 'replace', beforeHash, afterHash: sha(content), content, replacements: edit.replaceAll ? occurrences : 1, mode: stat.mode };
  }

  switch (request.op) {
    case 'searchPaths': {
      const { files, excluded } = listFiles(request);
      const query = String(request.query ?? '').toLowerCase();
      const matched = files.filter((file) => !query || file.toLowerCase().includes(query));
      const offset = cursorOf(request.cursor);
      const page = matched.slice(offset, offset + request.limit);
      return {
        items: page.map((file) => ({ path: file, size: fs.statSync(path.join(root, file)).size })),
        total: matched.length,
        truncated: offset + page.length < matched.length,
        ...(offset + page.length < matched.length && { nextCursor: encodeCursor(offset + page.length), truncatedReason: 'limit' }),
        excluded,
        outcome: matched.length ? 'matches' : files.length ? 'no_matches' : excluded.filter ? 'excluded_by_filter' : 'no_files',
      };
    }
    case 'searchContent': {
      const deadline = Date.now() + (request.timeoutMs ?? 10_000);
      const { files, excluded } = listFiles(request);
      const skipped: Record<string, number> = { binary: 0, large: 0, encoding: 0 };
      const flags = request.caseSensitive ? 'g' : 'gi';
      let pattern: RegExp;
      try {
        pattern = request.regex
          ? new RegExp(request.query, flags)
          : new RegExp(String(request.query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      } catch {
        return fail('invalid_regex', 'Expressão regular inválida.');
      }
      const offset = cursorOf(request.cursor);
      const matches: any[] = [];
      let seen = 0;
      let scanned = 0;
      let timedOut = false;
      let more = false;
      for (const file of files) {
        if (Date.now() > deadline) {
          timedOut = true;
          break;
        }
        const absolute = path.join(root, file);
        const stat = fs.statSync(absolute);
        if (stat.size > (request.maxFileBytes ?? 1_000_000)) {
          skipped.large!++;
          continue;
        }
        const buffer = fs.readFileSync(absolute);
        if (isBinary(buffer)) {
          skipped.binary!++;
          continue;
        }
        const text = decode(buffer);
        if (text === undefined) {
          skipped.encoding!++;
          continue;
        }
        scanned++;
        const lines = splitLines(text);
        for (let index = 0; index < lines.length; index++) {
          pattern.lastIndex = 0;
          const found = pattern.exec(lines[index]!);
          if (!found) continue;
          if (seen++ < offset) continue;
          if (matches.length >= request.limit) {
            more = true;
            break;
          }
          const context = request.contextLines ?? 0;
          matches.push({
            path: file,
            line: index + 1,
            column: found.index + 1,
            text: lines[index]!.length > 300 ? `${lines[index]!.slice(0, 300)}…` : lines[index],
            ...(context > 0 && {
              before: lines.slice(Math.max(0, index - context), index).map((line) => line.slice(0, 300)),
              after: lines.slice(index + 1, index + 1 + context).map((line) => line.slice(0, 300)),
            }),
          });
        }
        if (more) break;
      }
      return {
        matches,
        filesScanned: scanned,
        excluded,
        skipped,
        truncated: more || timedOut,
        ...(more && { truncatedReason: 'limit', nextCursor: encodeCursor(offset + matches.length) }),
        ...(timedOut && { truncatedReason: 'timeout', nextCursor: encodeCursor(offset + matches.length) }),
        outcome: timedOut && !matches.length ? 'timeout' : matches.length ? 'matches' : files.length ? 'no_matches' : 'excluded_by_filter',
      };
    }
    case 'readRange': {
      const target = resolve(request.path, true);
      const stat = fs.statSync(target.absolute);
      if (!stat.isFile()) fail('not_a_file', 'Não é um arquivo regular.');
      const buffer = fs.readFileSync(target.absolute);
      if (isBinary(buffer)) fail('binary_file', 'Arquivo binário; use outra ferramenta para inspecioná-lo.', { size: buffer.length });
      const text = decode(buffer);
      if (text === undefined) fail('unsupported_encoding', 'Arquivo não está em UTF-8.', { size: buffer.length });
      const lines = splitLines(text!);
      const total = lines.length;
      const start = request.startLine ?? 1;
      if (total > 0 && start > total) fail('invalid_range', `O arquivo tem ${total} linhas.`, { totalLines: total });
      if (request.endLine !== undefined && request.endLine < start) fail('invalid_range', 'endLine deve ser maior ou igual a startLine.');
      const requestedEnd = Math.min(request.endLine ?? total, total);
      const out: string[] = [];
      let bytes = 0;
      let end = start - 1;
      for (let line = start; line <= requestedEnd; line++) {
        const value = lines[line - 1]!;
        const size = Buffer.byteLength(value, 'utf8') + 1;
        if (bytes + size > request.maxBytes && out.length) break;
        out.push(value);
        bytes += size;
        end = line;
      }
      const crlf = text!.includes('\r\n');
      const lf = /(^|[^\r])\n/.test(text!);
      return {
        path: request.path,
        hash: sha(buffer),
        startLine: start,
        endLine: end,
        totalLines: total,
        totalBytes: buffer.length,
        content: out.join('\n'),
        truncated: end < (request.endLine ?? total),
        ...(end < (request.endLine ?? total) && {
          truncatedReason: end < requestedEnd ? 'max_bytes' : 'end_of_file',
          nextStartLine: end + 1,
        }),
        eol: crlf && lf ? 'mixed' : crlf ? 'crlf' : 'lf',
        finalNewline: text!.endsWith('\n'),
      };
    }
    case 'planEdits': {
      const planned = request.edits.map(plan);
      const seenPaths = new Set<string>();
      for (const item of planned) {
        if (seenPaths.has(item.path)) {
          item.ok = false;
          item.code = 'duplicate_path';
          item.message = 'Cada arquivo só pode aparecer uma vez no patch.';
        }
        seenPaths.add(item.path);
      }
      return {
        ok: planned.every((item: any) => item.ok),
        files: planned.map(({ content, mode, ...rest }: any) => {
          void content;
          void mode;
          return rest;
        }),
      };
    }
    case 'applyEdits': {
      // Re-validated here: the file may have changed between plan and apply.
      const planned = request.edits.map(plan);
      const skip = new Set<string>(request.skipPaths ?? []);
      const failures = planned.filter((item: any) => !item.ok && !skip.has(item.path));
      if (failures.length) return { ok: false, applied: [], files: failures };
      const applied: any[] = [];
      for (const item of planned) {
        if (skip.has(item.path)) continue;
        const target = resolve(item.path, item.action !== 'create');
        if (item.action === 'delete') fs.rmSync(target.absolute);
        else writeAtomic(target.absolute, item.content, item.mode);
        applied.push({ path: item.path, beforeHash: item.beforeHash, afterHash: item.afterHash });
        if (request.progress) process.stderr.write(`OINKO_APPLIED ${JSON.stringify(item.path)}\n`);
        // Fault injection for crash tests: only the runner can enable it, never a caller.
        if (request.faultAfterWrites !== undefined && applied.length >= request.faultAfterWrites) {
          if (request.faultMode === 'exit') process.exit(86);
          fail('fault_injected', 'Falha injetada após escrita parcial.', { applied });
        }
      }
      return { ok: true, applied, revision: request.withRevision === false ? undefined : treeHash() };
    }
    case 'hashes': {
      const out: Record<string, string> = {};
      for (const relative of request.paths as string[]) {
        const target = resolve(relative, false);
        out[relative] = target.exists ? sha(fs.readFileSync(target.absolute)) : 'absent';
      }
      return { hashes: out };
    }
    case 'treeHash':
      return { revision: treeHash() };
    case 'gitSnapshot': {
      let headSha: string;
      try {
        headSha = git(['rev-parse', 'HEAD']).trim();
      } catch {
        headSha = ''; // unborn branch
      }
      const files: Record<string, string> = {};
      for (const entry of git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean)) {
        const file = entry.slice(3);
        if (!file) continue;
        const absolute = path.join(root, file);
        files[file] = fs.existsSync(absolute) && fs.statSync(absolute).isFile() ? sha(fs.readFileSync(absolute)) : 'absent';
      }
      return { headSha, revision: treeHash(), files };
    }
    case 'gitDiff': {
      const snapshot = workspaceOps({ ...request, op: 'gitSnapshot' }, deps);
      const baseline = request.baseline ?? { headSha: snapshot.headSha, files: {} };
      const runFiles: string[] = [];
      const preexisting: string[] = [];
      for (const [file, hash] of Object.entries(snapshot.files) as [string, string][]) {
        if (baseline.files[file] === hash) preexisting.push(file);
        else runFiles.push(file);
      }
      // Files dirty at the start that the run brought back to HEAD are changes too.
      for (const file of Object.keys(baseline.files)) if (!(file in snapshot.files)) runFiles.push(file);
      const index = path.join(require_tmp(), `oinko-diff-${process.pid}-${Math.random().toString(16).slice(2)}`);
      let patch = '';
      let stat = '';
      try {
        const env = { GIT_INDEX_FILE: index };
        try {
          git(['read-tree', 'HEAD'], env);
        } catch {
          /* unborn branch */
        }
        git(['add', '-A', '--', '.'], env);
        const base = baseline.headSha || snapshot.headSha;
        if (runFiles.length && base) {
          patch = git(['diff', '--cached', '--no-color', '--no-ext-diff', base, '--', ...runFiles.sort()], env);
          stat = git(['diff', '--cached', '--no-color', '--stat', base, '--', ...runFiles], env);
        }
      } finally {
        fs.rmSync(index, { force: true });
      }
      const limit = request.maxPatchBytes ?? 200_000;
      return {
        headSha: snapshot.headSha,
        baseSha: baseline.headSha,
        revision: snapshot.revision,
        runFiles: runFiles.sort(),
        preexisting: preexisting.sort(),
        stat: stat.trim(),
        patch: patch.length > limit ? patch.slice(0, limit) : patch,
        patchBytes: Buffer.byteLength(patch),
        truncated: patch.length > limit,
      };
    }
    case 'projectContext': {
      const targets: string[] = request.targets?.length ? request.targets : ['.'];
      const read = (relative: string, max: number) => {
        const absolute = path.join(root, relative);
        const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) return undefined;
        const buffer = fs.readFileSync(absolute);
        const text = decode(buffer);
        if (text === undefined) return undefined;
        return { path: relative, hash: sha(buffer), content: text.length > max ? `${text.slice(0, max)}\n…[truncated]` : text, truncated: text.length > max };
      };
      const directories = new Set<string>();
      for (const target of targets) {
        const { absolute } = resolve(target, false);
        const relativeDir = path.relative(root, fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() ? absolute : path.dirname(absolute));
        const parts = relativeDir.split(path.sep).filter(Boolean);
        for (let i = 0; i <= parts.length; i++) directories.add(parts.slice(0, i).join('/') || '.');
      }
      const ordered = [...directories].sort((a, b) => (a === '.' ? -1 : b === '.' ? 1 : a.split('/').length - b.split('/').length || (a < b ? -1 : 1)));
      const instructions: any[] = [];
      const readmes: any[] = [];
      const manifests: any[] = [];
      for (const directory of ordered) {
        const prefix = directory === '.' ? '' : `${directory}/`;
        const agents = read(`${prefix}AGENTS.md`, 16_000);
        if (agents) instructions.push({ ...agents, scope: directory, precedence: directory === '.' ? 0 : directory.split('/').length, untrusted: true });
        const readme = read(`${prefix}README.md`, 4_000);
        if (readme) readmes.push({ ...readme, scope: directory, untrusted: true });
        const pkg = read(`${prefix}package.json`, 200_000);
        if (pkg) {
          try {
            const manifest = JSON.parse(pkg.content);
            manifests.push({ path: pkg.path, kind: 'package.json', scope: directory, hash: pkg.hash, name: manifest.name, scripts: manifest.scripts ?? {}, packageManager: manifest.packageManager, workspaces: manifest.workspaces });
          } catch {
            manifests.push({ path: pkg.path, kind: 'package.json', scope: directory, hash: pkg.hash, invalid: true });
          }
        }
        for (const [name, kind] of [['pyproject.toml', 'python'], ['go.mod', 'go'], ['Cargo.toml', 'rust'], ['Makefile', 'make'], ['pnpm-workspace.yaml', 'pnpm-workspace']] as const) {
          const file = read(`${prefix}${name}`, 20_000);
          if (file) manifests.push({ path: file.path, kind, scope: directory, hash: file.hash, ...(kind === 'make' && { targets: [...file.content.matchAll(/^([A-Za-z0-9_.-]+):/gm)].map((match) => match[1]) }) });
        }
      }
      const has = (name: string) => fs.existsSync(path.join(root, name));
      const manager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : has('package-lock.json') ? 'npm' : manifests.some((item) => item.kind === 'package.json') ? 'npm' : undefined;
      const commands: any[] = [];
      const push = (entry: any) => {
        if (!commands.some((item) => item.kind === entry.kind && item.cwd === entry.cwd)) commands.push(entry);
      };
      for (const override of request.overrides ?? [])
        push({ kind: override.kind, command: override.command, cwd: override.path ?? '.', origin: 'override' });
      if (manager) {
        const install = manager === 'pnpm' ? 'pnpm install --frozen-lockfile' : manager === 'yarn' ? 'yarn install --frozen-lockfile' : manager === 'bun' ? 'bun install' : has('package-lock.json') ? 'npm ci' : 'npm install';
        push({ kind: 'install', command: install, cwd: '.', origin: `lockfile:${manager}` });
      }
      // Nearest manifest first: a package's own scripts win over the root's.
      for (const manifest of [...manifests].reverse()) {
        if (manifest.kind === 'package.json' && manager) {
          for (const kind of ['test', 'lint', 'build', 'typecheck', 'format'])
            if (typeof manifest.scripts?.[kind] === 'string')
              push({ kind, command: `${manager} run ${kind}`, cwd: manifest.scope, origin: `${manifest.path}#scripts.${kind}` });
        }
        if (manifest.kind === 'python') push({ kind: 'test', command: 'python -m pytest', cwd: manifest.scope, origin: manifest.path });
        if (manifest.kind === 'go') push({ kind: 'test', command: 'go test ./...', cwd: manifest.scope, origin: manifest.path });
        if (manifest.kind === 'rust') push({ kind: 'test', command: 'cargo test', cwd: manifest.scope, origin: manifest.path });
        if (manifest.kind === 'make')
          for (const kind of ['test', 'lint', 'build'])
            if (manifest.targets?.includes(kind)) push({ kind, command: `make ${kind}`, cwd: manifest.scope, origin: `${manifest.path}#${kind}` });
      }
      return { instructions, readmes, manifests, commands, packageManager: manager };
    }
    default:
      return fail('unknown_op', `Operação desconhecida: ${String(request.op)}`);
  }
}

/** Script run by `node -e` in the sandbox: JSON request on stdin, JSON reply on stdout. */
export const WORKSPACE_OPS_SCRIPT = `
const deps = { fs: require('node:fs'), path: require('node:path'), crypto: require('node:crypto'), child: require('node:child_process') };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const result = (${workspaceOps.toString()})(JSON.parse(input), deps);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: { code: error.opsCode || 'ops_failed', message: String(error.message || error).slice(0, 2000), details: error.details } }));
  }
});
`;

/** Runs `workspaceOps` in this process (tests only: production always goes through the sandbox). */
export async function runOpsLocally(request: unknown): Promise<unknown> {
  const deps: OpsDeps = {
    fs: await import('node:fs'),
    path: await import('node:path'),
    crypto: await import('node:crypto'),
    child: await import('node:child_process'),
  };
  try {
    return workspaceOps(request, deps);
  } catch (error) {
    const value = error as Error & { opsCode?: string; details?: Record<string, unknown> };
    return { error: { code: value.opsCode ?? 'ops_failed', message: value.message, details: value.details } };
  }
}
