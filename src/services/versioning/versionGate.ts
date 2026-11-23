/**
 * Whether generation would be blocked by the `$version` reference gate. The release flows ask
 * before they prompt or write, so a design that cannot be generated never gets a recorded
 * release; generation itself then reports the gate errors through its normal channel.
 */
import * as yaml from 'js-yaml';
import { checkVersionRefsForGeneration } from '../../generator/validation/versionDiagnostics';
import { loadMemoryMaps, normalizeIpCoreData } from '../../generator/registerProcessor';
import type { FileReader } from '../imports/resolveMemoryMapImports';

/**
 * Runs the same check `IpCoreScaffolder.generateAll` runs (`checkVersionRefsForGeneration` on the
 * authored maps with the core's scheme and version); warnings do not count. `reader` supplies the
 * imported memory map text (default: the file system).
 */
export async function hasVersionGateErrors(
  ipText: string,
  ipPath: string,
  reader?: FileReader
): Promise<boolean> {
  const raw = yaml.load(ipText);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return false;
  }
  const ipCore = normalizeIpCoreData(raw as Record<string, unknown>);
  const maps = await loadMemoryMaps(ipCore, ipPath, reader);
  return checkVersionRefsForGeneration(ipCore, maps).some((issue) => issue.severity === 'error');
}
