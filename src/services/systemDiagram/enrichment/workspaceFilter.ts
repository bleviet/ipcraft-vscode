/**
 * Which workspace paths never hold hand-written definitions: dependencies,
 * version control, and the directories Vivado generates (`*.gen`, `*.cache`,
 * `*.ip_user_files`, `*.runs`, `*.sim`, `.Xil`). Pure. The list is defined
 * once; the path test and the `findFiles` exclude glob are both derived from it.
 */

/** Directories ignored by exact name. */
const IGNORED_NAMES = ['node_modules', '.git', '.Xil'];
/** Directories ignored by `<anything>.<suffix>`. */
const IGNORED_SUFFIXES = ['gen', 'cache', 'ip_user_files', 'runs', 'sim'];

const IGNORED_SEGMENT = new RegExp(
  `^(?:${IGNORED_NAMES.map(escapeRegExp).join('|')})$|\\.(?:${IGNORED_SUFFIXES.map(escapeRegExp).join('|')})$`
);

/** One `findFiles` exclude glob per ignored directory kind. */
export const IGNORED_DIRECTORY_GLOBS: readonly string[] = [
  ...IGNORED_NAMES.map((name) => `**/${name}/**`),
  ...IGNORED_SUFFIXES.map((suffix) => `**/*.${suffix}/**`),
];

export function isIgnoredWorkspacePath(fsPath: string): boolean {
  return fsPath.split(/[\\/]/).some((segment) => IGNORED_SEGMENT.test(segment));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
