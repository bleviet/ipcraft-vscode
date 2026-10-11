import * as path from 'path';

/** A path-valued field in a YAML document, resolved against the owning IP's directory. */
export interface PathRef {
  /** Location of the value inside the YAML document that holds it. */
  editPath: (string | number)[];
  value: string;
  abs: string;
}

export interface SubcoreRef extends PathRef {
  vlnv: string;
}

export interface IpReferences {
  /** `memoryMaps` imports and `fileSets[].files[].path` values. */
  files: PathRef[];
  /** `fileSets[].import` values (their inner file paths are collected separately). */
  filesetImports: PathRef[];
  busLibrary?: PathRef;
  subcores: SubcoreRef[];
  warnings: string[];
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

function ref(editPath: (string | number)[], value: unknown, root: string): PathRef | undefined {
  return typeof value === 'string' && value
    ? { editPath, value, abs: path.resolve(root, value) }
    : undefined;
}

/** `files[].path` refs of one fileset object; `prefix` locates the object in its document. */
function filesetFileRefs(fileSet: unknown, prefix: (string | number)[], root: string): PathRef[] {
  const files = isObj(fileSet) && Array.isArray(fileSet.files) ? fileSet.files : [];
  return files.flatMap((f, j) => {
    const r = isObj(f) ? ref([...prefix, 'files', j, 'path'], f.path, root) : undefined;
    return r ? [r] : [];
  });
}

/** File refs inside an imported fileset YAML (an object or an array of objects). */
export function collectImportedFilesetRefs(parsed: unknown, root: string): PathRef[] {
  return Array.isArray(parsed)
    ? parsed.flatMap((fs, k) => filesetFileRefs(fs, [k], root))
    : filesetFileRefs(parsed, [], root);
}

/** Every path an `.ip.yml` document references, resolved against `root`. */
export function collectReferences(data: unknown, root: string): IpReferences {
  const out: IpReferences = { files: [], filesetImports: [], subcores: [], warnings: [] };
  if (!isObj(data)) {
    return out;
  }
  const push = (list: PathRef[], r: PathRef | undefined): void => {
    if (r) {
      list.push(r);
    }
  };

  const { memoryMaps } = data;
  if (Array.isArray(memoryMaps)) {
    memoryMaps.forEach((m, i) => {
      push(out.files, isObj(m) ? ref(['memoryMaps', i, 'import'], m.import, root) : undefined);
    });
  } else if (isObj(memoryMaps)) {
    push(out.files, ref(['memoryMaps', 'import'], memoryMaps.import, root));
  }

  if (Array.isArray(data.fileSets)) {
    data.fileSets.forEach((fs, i) => {
      const imported = isObj(fs) ? ref(['fileSets', i, 'import'], fs.import, root) : undefined;
      if (imported) {
        out.filesetImports.push(imported);
      } else {
        out.files.push(...filesetFileRefs(fs, ['fileSets', i], root));
      }
    });
  }

  out.busLibrary = ref(['useBusLibrary'], data.useBusLibrary, root);

  if (Array.isArray(data.subcores)) {
    data.subcores.forEach((s, i) => {
      const vlnv = typeof s === 'string' ? s : isObj(s) ? String(s.vlnv ?? '') : '';
      const r = isObj(s) ? ref(['subcores', i, 'path'], s.path, root) : undefined;
      if (r) {
        out.subcores.push({ ...r, vlnv });
      } else {
        out.warnings.push(`Subcore ${vlnv} has no path; not bundled (add "path:" to include it)`);
      }
    });
  }
  return out;
}
