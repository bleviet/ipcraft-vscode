/**
 * The reports extracted from Vivado checkpoints, kept in the extension's storage (never in the
 * user's project): `<storage>/resource-extracts/<sha1 of the checkpoint path>/`, stamped with the
 * modification time of the checkpoint they were extracted from, so they are reused until the
 * run changes. Extension side, no `vscode`.
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const EXTRACTS_DIR = 'resource-extracts';
const STAMP_FILE = 'source.json';

/** What a checkpoint of a run writes. */
export const HIERARCHICAL_REPORT = 'utilization_hier.rpt';
export const FLAT_REPORT = 'utilization_flat.rpt';
/** The report of an out-of-context IP checkpoint: the name Vivado gives it in the IP's run. */
export const oocReportName = (xciName: string): string => `${xciName}_utilization_synth.rpt`;

/** A name that is one path component: safe to put in a file path and to hand to a tool as a file name. */
export const isPlainName = (name: string): boolean =>
  name !== '' &&
  name !== '.' &&
  name !== '..' &&
  !/[\\/]/.test(name) &&
  path.basename(name) === name;

interface Stamp {
  dcp: string;
  mtimeMs: number;
}

export const extractionDir = (storage: string, dcp: string): string =>
  path.join(
    storage,
    EXTRACTS_DIR,
    createHash('sha1').update(path.resolve(dcp)).digest('hex').slice(0, 16)
  );

/**
 * The files of the cached extraction of `dcp` (named `names`), or undefined when there is none
 * or the checkpoint has changed since.
 */
export async function cachedReports(
  storage: string,
  dcp: string,
  names: string[]
): Promise<string[] | undefined> {
  const dir = extractionDir(storage, dcp);
  try {
    const stamp = JSON.parse(await fs.readFile(path.join(dir, STAMP_FILE), 'utf8')) as Stamp;
    if (stamp.mtimeMs !== (await fs.stat(dcp)).mtimeMs) {
      return undefined;
    }
    const files = names.map((name) => path.join(dir, name));
    await Promise.all(files.map((file) => fs.access(file)));
    return files;
  } catch {
    return undefined;
  }
}

/** Marks the extraction of `dcp` as complete; written last, so an interrupted run is never reused. */
export async function writeStamp(storage: string, dcp: string, mtimeMs: number): Promise<void> {
  const stamp: Stamp = { dcp, mtimeMs };
  await fs.writeFile(path.join(extractionDir(storage, dcp), STAMP_FILE), JSON.stringify(stamp));
}
