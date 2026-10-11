import * as path from 'path';

/** True when `target` is `root` itself or lies below it. */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

/** Deepest directory that contains `root` and every path in `targets`. */
export function commonAncestor(root: string, targets: string[]): string {
  let candidate = root;
  while (!targets.every((t) => isInside(candidate, t))) {
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        `Cannot package: ${targets.find((t) => !isInside(candidate, t))} shares no common ` +
          `ancestor with ${root} (different drives?)`
      );
    }
    candidate = parent;
  }
  return candidate;
}

/**
 * Maps an absolute path to its package-relative POSIX path. Paths inside `root` keep their
 * relative location; external ones go under `deps/`, relative to the common ancestor of
 * `root` and all `externals`.
 */
export function createPathMapper(root: string, externals: string[]): (abs: string) => string {
  const outside = externals.filter((p) => !isInside(root, p));
  const ancestor = outside.length > 0 ? commonAncestor(root, outside) : root;
  return (abs: string): string => {
    const rel = isInside(root, abs)
      ? path.relative(root, abs)
      : path.join('deps', path.relative(ancestor, abs));
    return rel.split(path.sep).join('/');
  };
}
