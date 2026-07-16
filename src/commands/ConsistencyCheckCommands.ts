/**
 * VS Code command surfacing the full consistency check (issue #84): cross-references a
 * .ip.yml's declared ports/clocks/resets/parameters against every implementation source
 * available for it — the managed:false HDL top (issue #74) plus, when scaffolded, the
 * conventional Platform Designer (_hw.tcl) and Vivado (component.xml) vendor artifacts — in
 * both directions (SSOT-only and implementation-only drift).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { ResourceRoots } from '../services/ResourceRoots';
import { loadIpCoreData } from '../generator/loadIpCore';
import {
  crossCheckIpCoreAgainstHdl,
  crossCheckIpCoreAgainstVendor,
  HdlCrossCheckFinding,
} from '../generator/validation/hdlCrossCheck';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { getActiveIpCoreFile } from './GenerateCommands';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

const logger = new Logger('ConsistencyCheckCommands');

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('IPCraft Consistency Check');
  return outputChannel;
}

export interface ConsistencySummary {
  /** Implementation-only items (extra-port / extra-parameter) — a plausible Adopt. */
  added: number;
  /** SSOT-only items (missing-port / missing-parameter) — declared but gone from the impl. */
  removed: number;
  /** Both sides declare it, but a property (direction/width/default) disagrees. */
  changed: number;
}

export interface ConsistencyCheckResult {
  findings: HdlCrossCheckFinding[];
  summary: ConsistencySummary;
}

const ADDED_KINDS = new Set(['extra-port', 'extra-parameter']);
const REMOVED_KINDS = new Set(['missing-port', 'missing-parameter']);

function summarize(findings: HdlCrossCheckFinding[]): ConsistencySummary {
  const summary: ConsistencySummary = { added: 0, removed: 0, changed: 0 };
  for (const finding of findings) {
    if (ADDED_KINDS.has(finding.kind)) {
      summary.added++;
    } else if (REMOVED_KINDS.has(finding.kind)) {
      summary.removed++;
    } else {
      summary.changed++;
    }
  }
  return summary;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export async function runConsistencyCheck(
  ipCoreUri: vscode.Uri,
  resourceRoots: ResourceRoots
): Promise<ConsistencyCheckResult> {
  const ipCoreData = await loadIpCoreData(ipCoreUri.fsPath, resourceRoots);
  const ipCoreDir = path.dirname(ipCoreUri.fsPath);

  const findings: HdlCrossCheckFinding[] = [
    ...(await crossCheckIpCoreAgainstHdl(ipCoreData, ipCoreDir)),
  ];

  // Vendor artifacts live at conventional paths (see hdlCrossCheck.ts's vendorRelPath) and are
  // only cross-checked once actually scaffolded — an un-scaffolded project isn't "drifted".
  const name = ipCoreData.vlnv?.name;
  if (name && (await fileExists(path.join(ipCoreDir, 'altera', `${name.toLowerCase()}_hw.tcl`)))) {
    findings.push(...(await crossCheckIpCoreAgainstVendor(ipCoreData, ipCoreDir, 'hwTcl')));
  }
  if (await fileExists(path.join(ipCoreDir, 'xilinx', 'component.xml'))) {
    findings.push(...(await crossCheckIpCoreAgainstVendor(ipCoreData, ipCoreDir, 'componentXml')));
  }

  return { findings, summary: summarize(findings) };
}

function formatFinding(finding: HdlCrossCheckFinding): string {
  const yamlLocation = finding.ipYmlPath.join('.');
  return (
    `  [${finding.severity}/${finding.kind}] .ip.yml:${yamlLocation} (${finding.source}: ` +
    `${finding.hdlFile}) — ${finding.message}`
  );
}

export function registerConsistencyCheckCommands(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots
): void {
  safeRegisterCommand(
    context,
    'fpga-ip-core.checkConsistency',
    async (resourceUri?: vscode.Uri) => {
      const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
      if (!ipCoreUri) {
        return;
      }

      const ch = getOutputChannel();
      try {
        const { findings, summary } = await runConsistencyCheck(ipCoreUri, resourceRoots);

        if (findings.length === 0) {
          void vscode.window.showInformationMessage(
            `IPCraft: ${path.basename(ipCoreUri.fsPath)} is consistent with its implementation.`
          );
          return;
        }

        ch.clear();
        ch.appendLine(`IPCraft consistency check — ${path.basename(ipCoreUri.fsPath)}`);
        ch.appendLine(
          `${findings.length} finding(s): ${summary.added} added, ${summary.removed} removed, ` +
            `${summary.changed} changed.`
        );
        for (const finding of findings) {
          ch.appendLine(formatFinding(finding));
        }
        ch.show();
        void vscode.window.showWarningMessage(
          `IPCraft: found ${findings.length} inconsistenc${findings.length === 1 ? 'y' : 'ies'} ` +
            `between the .ip.yml and its implementation. See "IPCraft Consistency Check" output.`
        );
      } catch (error) {
        logger.error('Consistency check failed', error as Error);
        void handleErrorWithUserNotification(
          error,
          'checkConsistency',
          `Consistency check failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
