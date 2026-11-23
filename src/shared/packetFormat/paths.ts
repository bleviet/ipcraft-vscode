/** Tiny pure POSIX-style path helpers (the shared layer must not depend on node `path`). Windows backslashes become `/`. */

export function normalizePath(p: string): string {
  const slashed = p.replace(/\\/g, '/');
  const drive = /^[A-Za-z]:/.exec(slashed)?.[0] ?? '';
  const rest = slashed.slice(drive.length);
  const absolute = rest.startsWith('/');
  const out: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..' && out.length > 0 && out[out.length - 1] !== '..') {
      out.pop();
    } else if (part !== '..' || !absolute) {
      out.push(part);
    }
  }
  return `${drive}${absolute ? '/' : ''}${out.join('/')}`;
}

export function dirname(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i < 0 ? '' : i === 0 ? '/' : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalizePath(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

/** `target` relative to `baseDir` (absolute `target` is kept), normalized. */
export function joinPath(baseDir: string, target: string): string {
  const t = target.replace(/\\/g, '/');
  return normalizePath(t.startsWith('/') || /^[A-Za-z]:/.test(t) ? t : `${baseDir}/${t}`);
}

/** Relative path from `fromDir` to `file`, with `/` separators. */
export function relativePath(fromDir: string, file: string): string {
  const a = normalizePath(fromDir).split('/').filter(Boolean);
  const b = normalizePath(file).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) {
    i++;
  }
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

export function isMapFile(p: string): boolean {
  return /\.pktmap\.ya?ml$/.test(p);
}
