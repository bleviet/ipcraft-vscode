import * as path from 'path';
import * as YAML from 'yaml';

/**
 * Rewrite fileSets[].files[].path entries in an ip.yml string so that each
 * path is expressed relative to `toDir` instead of `fromDir`.
 *
 * Used when component.xml lives inside a vendor subdirectory (e.g. xilinx/)
 * but the resulting ip.yml should be placed one level up (the IP root).
 */
export function rebaseIpYamlPaths(ipYamlText: string, fromDir: string, toDir: string): string {
  if (fromDir === toDir) {
    return ipYamlText;
  }
  const data = YAML.parse(ipYamlText) as Record<string, unknown>;
  type FileEntry = { path?: string };
  type FileSet = { files?: FileEntry[] };
  const fileSets = data.fileSets as FileSet[] | undefined;
  if (!Array.isArray(fileSets)) {
    return ipYamlText;
  }
  let changed = false;
  for (const fs of fileSets) {
    for (const f of fs.files ?? []) {
      if (f.path) {
        const absPath = path.resolve(fromDir, f.path);
        const newPath = path.relative(toDir, absPath).replace(/\\/g, '/');
        if (newPath !== f.path) {
          f.path = newPath;
          changed = true;
        }
      }
    }
  }
  return changed ? YAML.stringify(data, { lineWidth: 120 }) : ipYamlText;
}
