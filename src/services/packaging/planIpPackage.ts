import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { applyPathEdits, type PathEdit } from '../../yamledit';
import {
  collectImportedFilesetRefs,
  collectReferences,
  type PathRef,
  type SubcoreRef,
} from './collectReferences';
import { createPathMapper } from './pathMapping';

export interface IpPackagePlan {
  /** Package-relative POSIX path -> file content. */
  entries: Map<string, Uint8Array>;
  warnings: string[];
}

type Entries = Map<string, Uint8Array>;

interface PlanContext {
  warnings: string[];
  /** Missing paths, path conflicts and non-file references; reported together. */
  problems: string[];
}

const IP_YML = '.ip.yml';

function addEntry(ctx: PlanContext, entries: Entries, rel: string, content: Uint8Array): void {
  const existing = entries.get(rel);
  if (existing && Buffer.compare(existing, content) !== 0) {
    ctx.problems.push(`Package path conflict: different files map to '${rel}'`);
    return;
  }
  entries.set(rel, content);
}

function addAll(ctx: PlanContext, entries: Entries, prefix: string, source: Entries): void {
  for (const [rel, content] of source) {
    addEntry(ctx, entries, path.posix.join(prefix, rel), content);
  }
}

async function statOrUndefined(p: string): Promise<import('fs').Stats | undefined> {
  return fs.stat(p).catch(() => undefined);
}

/**
 * Reads a directory tree, following symlinks. Broken links are reported as missing and a
 * symlink back into a directory already on the current chain as a loop.
 */
async function readDirFiles(
  ctx: PlanContext,
  dir: string,
  rel = '',
  chain: string[] = [],
  out: Entries = new Map()
): Promise<Entries> {
  const here = path.join(dir, rel);
  const realHere = await fs.realpath(here);
  for (const name of await fs.readdir(here)) {
    const childRel = rel ? `${rel}/${name}` : name;
    const abs = path.join(dir, childRel);
    const stat = await statOrUndefined(abs);
    if (!stat) {
      ctx.problems.push(`Not found: ${abs}`);
    } else if (stat.isDirectory()) {
      const real = await fs.realpath(abs);
      if ([...chain, realHere].includes(real)) {
        ctx.problems.push(`Symlink loop: ${abs} -> ${real}`);
      } else {
        await readDirFiles(ctx, dir, childRel, [...chain, realHere], out);
      }
    } else {
      out.set(childRel, await fs.readFile(abs));
    }
  }
  return out;
}

const normalizeValue = (v: string): string =>
  v.split(path.sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '') || '.';

/** Refs whose value differs from their packaged location. */
function rewriteEdits(refs: PathRef[], map: (abs: string) => string): PathEdit[] {
  return refs
    .map((r) => ({ r, mapped: map(r.abs) || '.' }))
    .filter(({ r, mapped }) => normalizeValue(r.value) !== mapped)
    .map(({ r, mapped }) => ({ path: r.editPath, value: mapped }));
}

function applyEdits(bytes: Uint8Array, edits: PathEdit[]): Uint8Array {
  if (edits.length === 0) {
    return bytes;
  }
  const text = Buffer.from(bytes).toString('utf8');
  const edited = applyPathEdits(text, edits);
  return edited === text ? bytes : Buffer.from(edited, 'utf8');
}

/** The `.ip.yml` a subcore `path` designates: the file itself, or the VLNV match in a directory. */
async function findSubcoreIp(ref: SubcoreRef, ctx: PlanContext): Promise<string | undefined> {
  const stat = await statOrUndefined(ref.abs);
  if (!stat) {
    ctx.problems.push(`Not found: ${ref.abs}`);
    return undefined;
  }
  if (stat.isFile()) {
    return ref.abs;
  }
  const candidates = (await fs.readdir(ref.abs)).filter((n) => n.endsWith(IP_YML));
  for (const name of candidates) {
    try {
      const data = yaml.load(await fs.readFile(path.join(ref.abs, name), 'utf8')) as {
        vlnv?: Record<string, unknown>;
      } | null;
      const v = data?.vlnv;
      if (v && `${v.vendor}:${v.library}:${v.name}:${v.version}` === ref.vlnv) {
        return path.join(ref.abs, name);
      }
    } catch {
      // An unparsable sibling is skipped; it only matters if nothing else matches.
    }
  }
  ctx.problems.push(`Not found: ${ref.abs} (no ${IP_YML} with vlnv ${ref.vlnv})`);
  return undefined;
}

interface ImportedFileset {
  ref: PathRef;
  bytes: Uint8Array;
  inner: PathRef[];
}

/** Collects, copies and rewrites everything one IP references; returns IP-root-relative entries. */
async function packageOne(
  ipPath: string,
  ctx: PlanContext,
  /** Absolute .ip.yml path -> packaged root (POSIX, package-relative) along the recursion chain. */
  ancestors: Map<string, string>,
  packagedRoot: string
): Promise<Entries> {
  const root = path.dirname(ipPath);
  const ipBytes = await fs.readFile(ipPath);
  const refs = collectReferences(yaml.load(ipBytes.toString('utf8')), root);
  ctx.warnings.push(...refs.warnings);

  /** True when the reference exists (and is a file, unless `anyKind`); otherwise records a problem. */
  const exists = async (r: PathRef, anyKind = false, source?: string): Promise<boolean> => {
    const stat = await statOrUndefined(r.abs);
    if (!stat) {
      ctx.problems.push(`Not found: ${r.abs}`);
      return false;
    }
    if (!anyKind && !stat.isFile()) {
      ctx.problems.push(
        `${r.editPath.join('.')} '${r.value}' must be a file but is a directory: ${r.abs}${source ? ` (listed in ${source})` : ''}`
      );
      return false;
    }
    return true;
  };

  const files: PathRef[] = [];
  for (const r of refs.files) {
    if (await exists(r)) {
      files.push(r);
    }
  }

  const imports: ImportedFileset[] = [];
  for (const r of refs.filesetImports) {
    if (await exists(r)) {
      const bytes = await fs.readFile(r.abs);
      const inner = collectImportedFilesetRefs(yaml.load(bytes.toString('utf8')), root);
      for (const f of inner) {
        if (await exists(f, false, r.abs)) {
          files.push(f);
        }
      }
      imports.push({ ref: r, bytes, inner: inner.filter((f) => files.includes(f)) });
    }
  }

  const busLibrary =
    refs.busLibrary && (await exists(refs.busLibrary, true)) ? refs.busLibrary : undefined;

  const chain = new Map(ancestors).set(ipPath, packagedRoot);
  const subcores: { ref: SubcoreRef; ipPath: string }[] = [];
  const backRefEdits: PathEdit[] = [];
  for (const r of refs.subcores) {
    const subIp = await findSubcoreIp(r, ctx);
    // A sub-IP shared by several parents is re-planned under each parent's mapping and the
    // identical files are deduplicated; the cost grows with the number of paths through the tree.
    const ancestorRoot = subIp && chain.get(subIp);
    if (subIp && ancestorRoot !== undefined) {
      // Cycle: point at the already-packaged ancestor instead of bundling it again.
      const target =
        r.abs === subIp ? path.posix.join(ancestorRoot, path.basename(subIp)) : ancestorRoot;
      const value = path.posix.relative(packagedRoot, target) || '.';
      if (normalizeValue(r.value) !== value) {
        backRefEdits.push({ path: r.editPath, value });
      }
    } else if (subIp) {
      subcores.push({ ref: r, ipPath: subIp });
    }
  }

  const externals = [
    ...files.map((r) => r.abs),
    ...imports.map((i) => i.ref.abs),
    ...(busLibrary ? [busLibrary.abs] : []),
    ...subcores.map((s) => s.ref.abs),
  ];
  const map = createPathMapper(root, externals);

  const entries: Entries = new Map();
  for (const r of files) {
    addEntry(ctx, entries, map(r.abs), await fs.readFile(r.abs));
  }
  for (const i of imports) {
    addEntry(ctx, entries, map(i.ref.abs), applyEdits(i.bytes, rewriteEdits(i.inner, map)));
  }
  if (busLibrary) {
    const stat = await fs.stat(busLibrary.abs);
    if (stat.isDirectory()) {
      addAll(ctx, entries, map(busLibrary.abs), await readDirFiles(ctx, busLibrary.abs));
    } else {
      addEntry(ctx, entries, map(busLibrary.abs), await fs.readFile(busLibrary.abs));
    }
  }
  for (const { ipPath: subIp } of subcores) {
    const subRoot = map(path.dirname(subIp));
    const sub = await packageOne(subIp, ctx, chain, path.posix.join(packagedRoot, subRoot));
    addAll(ctx, entries, subRoot, sub);
  }

  const ownRefs = [
    ...refs.files,
    ...refs.filesetImports,
    ...(refs.busLibrary ? [refs.busLibrary] : []),
    ...subcores.map((s) => s.ref),
  ];
  addEntry(
    ctx,
    entries,
    path.basename(ipPath),
    applyEdits(ipBytes, [...rewriteEdits(ownRefs, map), ...backRefEdits])
  );
  return entries;
}

/**
 * Collects an `.ip.yml` and every file it references (transitively through `path:` subcores)
 * into a self-contained set of package-relative entries. Nothing is written to disk.
 */
export async function planIpPackage(ipYamlPath: string): Promise<IpPackagePlan> {
  const ctx: PlanContext = { warnings: [], problems: [] };
  const entries = await packageOne(path.resolve(ipYamlPath), ctx, new Map(), '');
  if (ctx.problems.length > 0) {
    throw new Error(`Cannot create package:\n${ctx.problems.map((m) => `  ${m}`).join('\n')}`);
  }
  return { entries, warnings: ctx.warnings };
}
