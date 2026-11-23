/**
 * The user's container links: which Tcl script generates a block design.
 * Stored per design in `.ipcraft/bd-links.json` at the workspace root, with
 * POSIX paths relative to that root. Pure.
 */

import * as path from 'path';

export const BD_LINKS_FILE = '.ipcraft/bd-links.json';

export interface BdLinksFile {
  version: 1;
  /** Design file -> block design name -> Tcl file. */
  links: Record<string, Record<string, string>>;
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === 'string');

/** Throws on invalid JSON or shape. */
export function parseBdLinks(text: string): BdLinksFile {
  const data = JSON.parse(text) as { version?: unknown; links?: unknown };
  const links = data?.links;
  if (
    data?.version !== 1 ||
    typeof links !== 'object' ||
    links === null ||
    Array.isArray(links) ||
    !Object.values(links).every(isStringRecord)
  ) {
    throw new Error(
      `${BD_LINKS_FILE} must be { "version": 1, "links": { <design>: { <bd>: <tcl> } } }`
    );
  }
  return { version: 1, links: links as BdLinksFile['links'] };
}

const relativeKey = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join('/');

/** True when `file` is a path strictly inside `root`. */
export const isInside = (root: string, file: string) => {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

/** The links of one design: `links` (block design -> absolute Tcl path) and `rejected` (block design -> value as written). */
export interface DesignLinks {
  links: Record<string, string>;
  rejected: Record<string, string>;
}

/**
 * Links of one design; keys and values are POSIX paths relative to `root`.
 * A target that is not a `.tcl` file inside `root` is rejected.
 */
export function linksForDesign(file: BdLinksFile, root: string, designFile: string): DesignLinks {
  const result: DesignLinks = { links: {}, rejected: {} };
  for (const [bdName, tcl] of Object.entries(file.links[relativeKey(root, designFile)] ?? {})) {
    const target = path.resolve(root, tcl);
    if (isInside(root, target) && target.toLowerCase().endsWith('.tcl')) {
      result.links[bdName] = target;
    } else {
      result.rejected[bdName] = tcl;
    }
  }
  return result;
}

/** Sets (or, with an undefined `tclFile`, removes) the link of `bdName` for `designFile`; an emptied design is dropped. */
export function setBdLink(
  file: BdLinksFile | undefined,
  root: string,
  designFile: string,
  bdName: string,
  tclFile: string | undefined
): BdLinksFile {
  const key = relativeKey(root, designFile);
  const links = { ...file?.links };
  const { [bdName]: _removed, ...rest } = links[key] ?? {};
  const design = tclFile === undefined ? rest : { ...rest, [bdName]: relativeKey(root, tclFile) };
  if (Object.keys(design).length === 0) {
    delete links[key];
  } else {
    links[key] = design;
  }
  return { version: 1, links };
}

const sorted = <T>(record: Record<string, T>) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** 2-space JSON, sorted keys, trailing newline. */
export function formatBdLinks(file: BdLinksFile): string {
  const links = Object.fromEntries(
    Object.entries(sorted(file.links)).map(([design, bds]) => [design, sorted(bds)])
  );
  return `${JSON.stringify({ version: 1, links }, null, 2)}\n`;
}
