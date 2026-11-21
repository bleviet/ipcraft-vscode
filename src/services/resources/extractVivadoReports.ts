/**
 * Writes the utilization reports of a Vivado checkpoint by opening it in one batch run. The
 * tool is started by a runner the caller passes in, so this module needs neither `vscode` nor the
 * toolchain configuration. Extension side.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ExtraMountSpec } from '../toolchains/LaunchableTool';
import {
  cachedReports,
  extractionDir,
  FLAT_REPORT,
  HIERARCHICAL_REPORT,
  isPlainName,
  oocReportName,
  writeStamp,
} from './extractionCache';

/** One Vivado call: the arguments after the launcher, the folder to run in, the mounts a container needs. */
export interface VivadoInvocation {
  args: string[];
  cwd: string;
  extraMounts: ExtraMountSpec[];
}

export interface VivadoRunResult {
  success: boolean;
  exitCode: number;
  /** The last lines the tool wrote. */
  output: string;
}

export type RunVivado = (invocation: VivadoInvocation) => Promise<VivadoRunResult>;

/** The tool failed or did not write a report; `outputTail` is the end of what it printed. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly outputTail: string
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

export interface ExtractedReports {
  /** Absent for an out-of-context IP checkpoint, which has no hierarchy worth a table. */
  hierarchical?: string;
  flat: string;
}

export interface ExtractRequest {
  dcp: string;
  /** The folder the reports are written to; it is the folder the tool runs in. */
  outDir: string;
  run: RunVivado;
  /** The tool runs in a container: the checkpoint folder is mounted at {@link DCP_MOUNT}, `outDir` at `/work`. */
  docker?: boolean;
  /** An out-of-context IP checkpoint: only its flat report is written. */
  ooc?: { xciName: string };
}

export const DCP_MOUNT = '/ipcraft-dcp';
const WORK_MOUNT = '/work';
const SCRIPT_NAME = 'extract.tcl';

// The names come in as arguments, never as script text.
const HIERARCHICAL_SCRIPT = `open_checkpoint [lindex $argv 0]
report_utilization -hierarchical -file [file join [lindex $argv 1] ${HIERARCHICAL_REPORT}]
report_utilization -file [file join [lindex $argv 1] ${FLAT_REPORT}]
exit
`;
const OOC_SCRIPT = `open_checkpoint [lindex $argv 0]
report_utilization -file [file join [lindex $argv 1] [lindex $argv 2]]
exit
`;

export async function extractCheckpoint(request: ExtractRequest): Promise<ExtractedReports> {
  const { dcp, outDir, run, docker, ooc } = request;
  if (ooc && !isPlainName(ooc.xciName)) {
    throw new ExtractionError(`"${ooc.xciName}" is not a valid IP name.`, '');
  }
  const script = path.join(outDir, SCRIPT_NAME);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(script, ooc ? OOC_SCRIPT : HIERARCHICAL_SCRIPT);

  const flatName = ooc ? oocReportName(ooc.xciName) : FLAT_REPORT;
  const result = await run({
    args: [
      '-mode',
      'batch',
      '-source',
      docker ? `${WORK_MOUNT}/${SCRIPT_NAME}` : script,
      '-nojournal',
      '-nolog',
      '-tclargs',
      docker ? `${DCP_MOUNT}/${path.basename(dcp)}` : dcp,
      docker ? WORK_MOUNT : outDir,
      ...(ooc ? [flatName] : []),
    ],
    cwd: outDir,
    extraMounts: docker ? [{ host: path.dirname(dcp), container: DCP_MOUNT, ro: true }] : [],
  });
  const name = path.basename(dcp);
  if (!result.success) {
    throw new ExtractionError(
      `Vivado could not write the report from ${name} (exit code ${result.exitCode}).`,
      result.output
    );
  }
  const reports: ExtractedReports = {
    ...(!ooc && { hierarchical: path.join(outDir, HIERARCHICAL_REPORT) }),
    flat: path.join(outDir, flatName),
  };
  for (const file of [reports.hierarchical, reports.flat]) {
    if (file !== undefined && !(await exists(file))) {
      throw new ExtractionError(
        `Vivado finished without writing ${path.basename(file)} for ${name}.`,
        result.output
      );
    }
  }
  return reports;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

export type ExtractToCacheRequest = Omit<ExtractRequest, 'outDir'> & {
  /** The extension's storage folder (see {@link extractionDir}). */
  storage: string;
};

/**
 * Extracts into the storage cache: the reports of an earlier extraction are reused while the
 * checkpoint keeps its modification time; otherwise they are replaced. A failed extraction leaves
 * nothing behind.
 */
export async function extractToCache(request: ExtractToCacheRequest): Promise<ExtractedReports> {
  const { dcp, storage, ooc } = request;
  const outDir = extractionDir(storage, dcp);
  const flatName = ooc ? oocReportName(ooc.xciName) : FLAT_REPORT;
  const cached = await cachedReports(
    storage,
    dcp,
    ooc ? [flatName] : [HIERARCHICAL_REPORT, FLAT_REPORT]
  );
  if (cached) {
    return ooc ? { flat: cached[0] } : { hierarchical: cached[0], flat: cached[1] };
  }
  const { mtimeMs } = await fs.stat(dcp);
  await fs.rm(outDir, { recursive: true, force: true });
  try {
    const reports = await extractCheckpoint({ ...request, outDir });
    await writeStamp(storage, dcp, mtimeMs);
    return reports;
  } catch (error) {
    await fs.rm(outDir, { recursive: true, force: true });
    throw error;
  }
}

/** The Vivado version a run's reports were written by (`2024.2`), to open its checkpoint with the same one. */
export async function vivadoVersionNear(dcp: string): Promise<string | undefined> {
  const dir = path.dirname(dcp);
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.endsWith('.rpt'))) {
    const handle = await fs.open(path.join(dir, name), 'r').catch(() => undefined);
    if (!handle) {
      continue;
    }
    try {
      const buffer = Buffer.alloc(2048);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const version = /^\|\s*Tool Version\s*:\s*Vivado v\.(\S+)/m.exec(
        buffer.toString('utf8', 0, bytesRead)
      )?.[1];
      if (version) {
        return version;
      }
    } finally {
      await handle.close();
    }
  }
  return undefined;
}
