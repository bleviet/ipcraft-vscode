import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Parses a _hw.tcl and returns unique resolved directories of all source files
 * referenced via `add_fileset_file ... PATH <rel>`.
 */
export async function sourceDirsFromHwTcl(hwTclPath: string): Promise<string[]> {
  const baseDir = path.dirname(hwTclPath);
  const content = await fs.readFile(hwTclPath, 'utf8');
  const dirs = new Set<string>();
  const re = /add_fileset_file\s+\S+\s+\S+\s+PATH\s+(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const abs = path.resolve(baseDir, m[1]);
    dirs.add(path.dirname(abs));
  }
  return filterExisting([...dirs]);
}

/**
 * Parses a component.xml and returns unique resolved directories of all source
 * files referenced in <spirit:name> elements (*.vhd, *.vhdl, *.sv, *.v).
 */
export async function sourceDirsFromComponentXml(componentXmlPath: string): Promise<string[]> {
  const baseDir = path.dirname(componentXmlPath);
  const content = await fs.readFile(componentXmlPath, 'utf8');
  const dirs = new Set<string>();
  const re = /<spirit:name>([^<]+\.(?:vhd|vhdl|sv|v))<\/spirit:name>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const rel = m[1].trim();
    const abs = path.isAbsolute(rel) ? rel : path.resolve(baseDir, rel);
    dirs.add(path.dirname(abs));
  }
  return filterExisting([...dirs]);
}

/** Converts a list of host directories into docker `-v dir:dir` argument pairs. */
export function buildMountArgs(dirs: string[]): string[] {
  return dirs.flatMap((d) => ['-v', `${d}:${d}`]);
}

async function filterExisting(dirs: string[]): Promise<string[]> {
  const results = await Promise.all(
    dirs.map((d) =>
      fs
        .access(d)
        .then(() => d)
        .catch(() => null)
    )
  );
  return results.filter((d): d is string => d !== null);
}
