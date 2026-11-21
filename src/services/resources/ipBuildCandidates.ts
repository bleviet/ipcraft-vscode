/**
 * The resource source made of IPCraft's own builds: the report each Build command left next to
 * the `.ip.yml` of a block (see `toolchains/buildPaths.ts`). Extension side (reads files), no `vscode`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { SystemGraph } from '../../domain/systemGraph';
import {
  ipCoreBuildName,
  quartusBuildDir,
  quartusOutputFilesDir,
  vivadoBuildDir,
} from '../toolchains/buildPaths';
import { readReport, type IpBuild, type ReportCandidate } from './reportCandidates';
import { commonDevice, readQuartusDevice } from './ipBuildUsage';
import type { RecognizedReport } from './reportKind';

/** The name of the group as the report's source: there is no single file. */
export const IP_BUILDS_NAME = 'IPCraft builds';

interface FoundReport {
  file: string;
  recognition: RecognizedReport;
  mode?: 'ooc' | 'xpr';
  capacityFile?: string;
  /** Vivado: the Device of the report; Quartus: that of the `.fit.summary`. */
  device?: string;
}

/** The name IPCraft's builds use for the IP core; none when the file cannot be read or names none. */
async function buildName(ipFile: string): Promise<string | undefined> {
  try {
    return ipCoreBuildName(yaml.load(await fs.readFile(ipFile, 'utf8')));
  } catch {
    return undefined;
  }
}

async function usableReport(
  file: string,
  kind: RecognizedReport['kind']
): Promise<RecognizedReport | undefined> {
  const { recognition } = await readReport(file);
  return recognition.recognized && recognition.kind === kind ? recognition : undefined;
}

/** The out-of-context report, else the full implementation one. */
async function vivadoReport(ipDir: string): Promise<FoundReport | undefined> {
  for (const mode of ['ooc', 'xpr'] as const) {
    const file = path.join(vivadoBuildDir(ipDir, mode), 'utilization.rpt');
    const recognition = await usableReport(file, 'vivado-flat');
    if (recognition) {
      return { file, recognition, mode, device: recognition.device };
    }
  }
  return undefined;
}

async function quartusReport(ipFile: string): Promise<FoundReport | undefined> {
  const name = await buildName(ipFile);
  if (name === undefined) {
    return undefined;
  }
  const outputDir = quartusOutputFilesDir(quartusBuildDir(path.dirname(ipFile)));
  const file = path.join(outputDir, `${name}.fit.rpt`);
  const recognition = await usableReport(file, 'quartus-entity');
  if (!recognition) {
    return undefined;
  }
  const summary = path.join(outputDir, `${name}.fit.summary`);
  const summaryText = await fs.readFile(summary, 'utf8').catch(() => undefined);
  return {
    file,
    recognition,
    ...(summaryText !== undefined && {
      capacityFile: summary,
      device: readQuartusDevice(summaryText),
    }),
  };
}

/**
 * One candidate for the blocks defined by an `.ip.yml` that have a build report, none when no
 * block has. The vendor follows the design format.
 */
export async function discoverIpBuilds(graph: SystemGraph): Promise<ReportCandidate[]> {
  const vendor = graph.source.format.startsWith('vivado') ? 'vivado' : 'quartus';
  const byFile = new Map<string, string[]>();
  let blocks = 0;
  for (const instance of Object.values(graph.instances)) {
    if (instance.definition?.kind === 'ip.yml') {
      blocks += 1;
      byFile.set(instance.definition.file, [
        ...(byFile.get(instance.definition.file) ?? []),
        instance.path,
      ]);
    }
  }
  const builds: IpBuild[] = [];
  const devices: Array<string | undefined> = [];
  let first: RecognizedReport | undefined;
  for (const [ipFile, instances] of byFile) {
    const found =
      vendor === 'vivado' ? await vivadoReport(path.dirname(ipFile)) : await quartusReport(ipFile);
    if (found) {
      first ??= found.recognition;
      devices.push(found.device);
      builds.push({
        instances,
        file: found.file,
        ...(found.mode !== undefined && { mode: found.mode }),
        ...(found.capacityFile !== undefined && { capacityFile: found.capacityFile }),
      });
    }
  }
  if (!first) {
    return [];
  }
  // The source line names a device only when every build is on it.
  const { device } = commonDevice(devices);
  const headline = { ...first };
  delete headline.device;
  const count = builds.reduce((sum, build) => sum + build.instances.length, 0);
  const post = builds
    .filter((build) => build.mode === 'xpr')
    .reduce((sum, build) => sum + build.instances.length, 0);
  const detail = `${count} of ${blocks} block${blocks === 1 ? '' : 's'}${post > 0 ? `, ${post} post-route` : ''}`;
  return [
    {
      id: 'ipBuilds',
      group: 'ipBuilds',
      vendor,
      stage: 'ooc',
      label: `${IP_BUILDS_NAME} (${detail})`,
      files: builds.flatMap((b) => [b.file, ...(b.capacityFile ? [b.capacityFile] : [])]),
      recognition: { ...headline, ...(device !== undefined && { device }) },
      usable: true,
      builds,
    },
  ];
}
