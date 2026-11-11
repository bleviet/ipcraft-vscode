/**
 * The block design scripts of a CMake Vivado project: the `DESIGN` list of
 * every `add_vivado_project(...)` call. Pure text scan; nothing is executed.
 */

import * as path from 'path';

export interface CmakeEntry {
  /** Absolute path of the `CMakeLists.txt`. */
  file: string;
  /** One list of absolute Tcl paths per `add_vivado_project` call. */
  projects: string[][];
}

const CALL = /add_vivado_project\s*\(/g;
const KEYWORD = /^[A-Z][A-Z0-9_]*$/;
const FOLDER_VARIABLES = /\$\{CMAKE_CURRENT_(?:LIST|SOURCE)_DIR\}/g;

/** The text between the parenthesis opened just before `start` and its match. */
function callArguments(text: string, start: number): string {
  let depth = 1;
  for (let index = start; index < text.length; index++) {
    depth += text[index] === '(' ? 1 : text[index] === ')' ? -1 : 0;
    if (depth === 0) {
      return text.slice(start, index);
    }
  }
  return text.slice(start);
}

/** The `DESIGN` lists of every `add_vivado_project(...)` call, as absolute paths. */
export function vivadoProjectDesigns(text: string, cmakeFile: string): string[][] {
  const folder = path.dirname(cmakeFile);
  const code = text.replace(/#.*$/gm, '');
  const projects: string[][] = [];
  for (const call of code.matchAll(CALL)) {
    const tokens = callArguments(code, (call.index ?? 0) + call[0].length)
      .split(/\s+/)
      .filter((token) => token !== '');
    const start = tokens.indexOf('DESIGN');
    if (start < 0) {
      continue;
    }
    const rest = tokens.slice(start + 1);
    const end = rest.findIndex((token) => KEYWORD.test(token));
    projects.push(
      (end < 0 ? rest : rest.slice(0, end))
        .flatMap((token) => token.split(';'))
        .map((item) => item.replace(/"/g, '').replace(FOLDER_VARIABLES, folder))
        .filter((item) => item !== '' && !item.includes('${'))
        .map((item) => path.resolve(folder, item))
    );
  }
  return projects;
}
