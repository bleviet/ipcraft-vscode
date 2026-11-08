/**
 * Pure splitter for unlisted VHDL files whose unit names collide across folders (for example one
 * `TestCtrl` per testbench folder). Each group of folders that depend on each other moves into its
 * own generated library, so every architecture and configuration binds to the nearest declaration
 * instead of one arbitrary copy. A group that a `defaultlib` file depends on stays in
 * `defaultlib`. Deterministic.
 */

import * as path from 'path';
import { workReferences, type LocalRefKind, type VhdlScan } from './vhdlUnitScanner';

export interface ScopeInput {
  /** Files of `defaultlib`; `listed` means a manifest names the file. Root-relative POSIX paths. */
  files: { path: string; listed: boolean }[];
  scans: ReadonlyMap<string, VhdlScan | undefined>;
  /** Generated, user-section and built-in library names that a scope library must not reuse. */
  takenNames: ReadonlySet<string>;
}

export interface ScopeLibrary {
  name: string;
  /** Unlisted files that moved out of `defaultlib`. */
  files: string[];
}

export interface ScopeResult {
  defaultFiles: string[];
  scopes: ScopeLibrary[];
}

interface FileInfo {
  path: string;
  dir: string;
  listed: boolean;
  declared: Set<string>;
  refs: Set<string>;
}

const ALL_KINDS: ReadonlySet<LocalRefKind> = new Set([
  'architecture',
  'body',
  'configuration',
  'instantiation',
]);
const PREFIX = 'defaultlib_';
const DEFAULT_NODE = '\0default';
const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const segmentsOf = (dir: string): string[] => (dir === '' ? [] : dir.split('/'));

function describe(file: ScopeInput['files'][number], scan: VhdlScan | undefined): FileInfo {
  const dir = path.posix.dirname(file.path);
  if (scan?.hasPlaceholders) {
    // A template declares and references nothing; the library builder excludes it.
    return {
      path: file.path,
      dir: dir === '.' ? '' : dir,
      listed: file.listed,
      declared: new Set(),
      refs: new Set(),
    };
  }
  return {
    path: file.path,
    dir: dir === '.' ? '' : dir,
    listed: file.listed,
    declared: new Set(scan?.units.map((u) => u.name)),
    refs: workReferences(scan, ALL_KINDS),
  };
}

function distance(a: string, b: string): number {
  const x = segmentsOf(a);
  const y = segmentsOf(b);
  let common = 0;
  while (common < x.length && common < y.length && x[common] === y[common]) {
    common++;
  }
  return x.length - common + (y.length - common);
}

function commonAncestor(dirs: string[]): string {
  let prefix = segmentsOf(dirs[0]);
  for (const dir of dirs.slice(1)) {
    const segments = segmentsOf(dir);
    let n = 0;
    while (n < prefix.length && n < segments.length && prefix[n] === segments[n]) {
      n++;
    }
    prefix = prefix.slice(0, n);
  }
  return prefix.join('/');
}

const sanitizeName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/_$/, '');

function sanitizedSegments(dir: string): string[] {
  const segments = segmentsOf(dir).map((s) => s.toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  return segments.length > 0 ? segments : ['root'];
}

function nameComponents(repDirs: string[], taken: ReadonlySet<string>): string[] {
  const segments = repDirs.map(sanitizedSegments);
  const suffixName = (i: number, k: number): string =>
    sanitizeName(PREFIX + segments[i].slice(-k).join('_'));
  const used = new Set(taken);
  return repDirs.map((_, i) => {
    let k = 1;
    while (
      k < segments[i].length &&
      segments.some((_s, j) => j !== i && suffixName(j, k) === suffixName(i, k))
    ) {
      k++;
    }
    const base = suffixName(i, k);
    let name = base;
    for (let n = 2; used.has(name); n++) {
      name = `${base}_${n}`;
    }
    used.add(name);
    return name;
  });
}

export function scopeLibraries(input: ScopeInput): ScopeResult {
  const infos = [...input.files]
    .sort((a, b) => byString(a.path, b.path))
    .map((f) => describe(f, input.scans.get(f.path)));
  const allPaths = infos.map((f) => f.path);

  const dirsByName = new Map<string, Set<string>>();
  const listedNames = new Set<string>();
  for (const info of infos) {
    for (const name of info.declared) {
      if (info.listed) {
        listedNames.add(name);
      } else {
        dirsByName.set(name, (dirsByName.get(name) ?? new Set()).add(info.dir));
      }
    }
  }
  const colliding = new Set(
    [...dirsByName].filter(([n, dirs]) => dirs.size >= 2 && !listedNames.has(n)).map(([n]) => n)
  );
  if (colliding.size === 0) {
    return { defaultFiles: allPaths, scopes: [] };
  }

  const seedsByName = new Map<string, string[]>();
  for (const info of infos) {
    if (info.listed) {
      continue;
    }
    for (const name of info.declared) {
      if (colliding.has(name)) {
        seedsByName.set(name, [...new Set([...(seedsByName.get(name) ?? []), info.dir])]);
      }
    }
  }
  const seeds = new Set([...seedsByName.values()].flat());
  const nearest = (from: string, name: string): string =>
    [...(seedsByName.get(name) as string[])].sort(
      (a, b) => distance(from, a) - distance(from, b) || a.length - b.length || byString(a, b)
    )[0];

  const parent = new Map<string, string>([[DEFAULT_NODE, DEFAULT_NODE]]);
  for (const seed of seeds) {
    parent.set(`d:${seed}`, `d:${seed}`);
  }
  const find = (node: string): string => {
    const up = parent.get(node) as string;
    return up === node ? node : find(up);
  };
  const union = (a: string, b: string): void => {
    const [ra, rb] = [find(a), find(b)].sort(byString);
    parent.set(rb, ra);
  };

  const homes = new Map<string, string>();
  for (const info of infos) {
    const sorted = [...info.refs].filter((r) => colliding.has(r)).sort(byString);
    if (info.listed) {
      sorted.forEach((r) => union(DEFAULT_NODE, `d:${nearest(info.dir, r)}`));
      continue;
    }
    const home = seeds.has(info.dir)
      ? info.dir
      : sorted.length > 0
        ? nearest(info.dir, sorted[0])
        : undefined;
    if (home !== undefined) {
      homes.set(info.path, home);
      sorted.forEach((r) => union(`d:${home}`, `d:${nearest(info.dir, r)}`));
    }
  }

  // A file that stays in defaultlib cannot reach a unit that moved out, so merge such groups in.
  const homedDeclarers = new Map<string, string[]>();
  for (const info of infos) {
    const home = homes.get(info.path);
    if (home !== undefined) {
      info.declared.forEach((n) =>
        homedDeclarers.set(n, [...(homedDeclarers.get(n) ?? []), `d:${home}`])
      );
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const info of infos) {
      const home = homes.get(info.path);
      if (home !== undefined && find(`d:${home}`) !== find(DEFAULT_NODE)) {
        continue;
      }
      for (const ref of [...info.refs].filter((r) => !colliding.has(r)).sort(byString)) {
        for (const node of homedDeclarers.get(ref) ?? []) {
          if (find(node) !== find(DEFAULT_NODE)) {
            union(DEFAULT_NODE, node);
            changed = true;
          }
        }
      }
    }
  }

  const defaultRoot = find(DEFAULT_NODE);
  const componentSeeds = new Map<string, string[]>();
  for (const seed of [...seeds].sort(byString)) {
    const root = find(`d:${seed}`);
    if (root !== defaultRoot) {
      componentSeeds.set(root, [...(componentSeeds.get(root) ?? []), seed]);
    }
  }
  const isMoved = (info: FileInfo): boolean => {
    const home = homes.get(info.path);
    return home !== undefined && find(`d:${home}`) !== defaultRoot;
  };
  const defaults = infos.filter((f) => !isMoved(f));

  const components = [...componentSeeds]
    .map(([root, dirs]) => ({ root, rep: commonAncestor(dirs) }))
    .sort((a, b) => byString(a.rep, b.rep));
  const names = nameComponents(
    components.map((c) => c.rep),
    input.takenNames
  );
  const scopes = components.map(({ root }, i): ScopeLibrary => {
    const files = infos.filter((f) => isMoved(f) && find(`d:${homes.get(f.path)}`) === root);
    return {
      name: names[i],
      files: files.map((f) => f.path),
    };
  });
  return { defaultFiles: defaults.map((f) => f.path), scopes };
}
