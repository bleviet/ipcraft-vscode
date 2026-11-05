/**
 * Which workspace paths never hold hand-written definitions: dependencies,
 * version control, and the directories Vivado generates (`*.gen`, `*.cache`,
 * `*.ip_user_files`, `*.runs`, `*.sim`, `.Xil`). Pure.
 */

const IGNORED_SEGMENT = /^(?:node_modules|\.git|\.Xil)$|\.(?:gen|cache|ip_user_files|runs|sim)$/;

export function isIgnoredWorkspacePath(fsPath: string): boolean {
  return fsPath.split(/[\\/]/).some((segment) => IGNORED_SEGMENT.test(segment));
}
