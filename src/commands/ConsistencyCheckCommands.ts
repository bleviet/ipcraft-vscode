/**
 * VS Code command surfacing the full consistency check (issue #84): cross-references a
 * .ip.yml's declared ports/clocks/resets/parameters against every implementation source
 * available for it — the top-level HDL entity/module (regardless of the managed flag — see
 * crossCheckIpCoreAgainstTopLevelHdl) plus, when scaffolded, the conventional Platform Designer
 * (_hw.tcl) and Vivado (component.xml) vendor artifacts — in both directions (SSOT-only and
 * implementation-only drift).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { ResourceRoots } from '../services/ResourceRoots';
import { IpCoreSchemaValidationError, loadIpCoreData } from '../generator/loadIpCore';
import {
  crossCheckIpCoreAgainstTopLevelHdl,
  crossCheckIpCoreAgainstVendor,
  HdlCrossCheckFinding,
} from '../generator/validation/hdlCrossCheck';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { getActiveIpCoreFile } from '../utils/activeIpCoreFile';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { loadRuntimeBusLibrary } from '../services/loadRuntimeBusLibrary';
import { checkBusConformance } from '../shared/busConformance';
import { deduplicateIssues, type IpcraftIssue } from '../shared/issues';

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
  /**
   * Informational only — the checker could not uniquely identify the top-level implementation
   * to diff against (issue #161), so no interface comparison happened at all. Not evidence of
   * actual .ip.yml/HDL drift, so kept out of `changed`.
   */
  ambiguous: number;
}

export interface ConsistencyCheckResult {
  findings: HdlCrossCheckFinding[];
  issues: IpcraftIssue[];
  summary: ConsistencySummary;
}

const ADDED_KINDS = new Set(['extra-port', 'extra-parameter', 'extra-register', 'extra-field']);
const REMOVED_KINDS = new Set([
  'missing-port',
  'missing-parameter',
  'missing-bus-port',
  'missing-register',
  'missing-field',
]);
const AMBIGUOUS_KINDS = new Set(['top-level-ambiguity']);

export function summarize(findings: HdlCrossCheckFinding[]): ConsistencySummary {
  const summary: ConsistencySummary = { added: 0, removed: 0, changed: 0, ambiguous: 0 };
  for (const finding of findings) {
    if (ADDED_KINDS.has(finding.kind)) {
      summary.added++;
    } else if (REMOVED_KINDS.has(finding.kind)) {
      summary.removed++;
    } else if (AMBIGUOUS_KINDS.has(finding.kind)) {
      summary.ambiguous++;
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
  let ipCoreData;
  try {
    ipCoreData = await loadIpCoreData(ipCoreUri.fsPath, resourceRoots);
  } catch (error) {
    if (error instanceof IpCoreSchemaValidationError) {
      return {
        findings: [],
        issues: [...error.issues],
        summary: { added: 0, removed: 0, changed: 0, ambiguous: 0 },
      };
    }
    throw error;
  }
  const ipCoreDir = path.dirname(ipCoreUri.fsPath);
  const busLibrary = await loadRuntimeBusLibrary(
    logger,
    resourceRoots,
    ipCoreUri,
    ipCoreData as Record<string, unknown>
  );
  const protocolReport = checkBusConformance(ipCoreData, busLibrary);

  const findings: HdlCrossCheckFinding[] = [
    ...(await crossCheckIpCoreAgainstTopLevelHdl(ipCoreData, ipCoreDir, busLibrary)),
  ];

  // Vendor artifacts live at conventional paths (see hdlCrossCheck.ts's vendorRelPath) and are
  // only cross-checked once actually scaffolded — an un-scaffolded project isn't "drifted".
  const name = ipCoreData.vlnv?.name;
  if (name && (await fileExists(path.join(ipCoreDir, 'altera', `${name.toLowerCase()}_hw.tcl`)))) {
    findings.push(
      ...(await crossCheckIpCoreAgainstVendor(ipCoreData, ipCoreDir, 'hwTcl', busLibrary))
    );
  }
  if (await fileExists(path.join(ipCoreDir, 'xilinx', 'component.xml'))) {
    findings.push(
      ...(await crossCheckIpCoreAgainstVendor(ipCoreData, ipCoreDir, 'componentXml', busLibrary))
    );
  }

  const implementationIssues = findings.map(
    (finding): IpcraftIssue => ({
      code: `CONSISTENCY_${finding.kind.replace(/-/g, '_').toUpperCase()}`,
      severity: finding.severity === 'red' ? 'error' : 'warning',
      source: finding.source,
      path: finding.ipYmlPath,
      message: finding.message,
    })
  );
  return {
    findings,
    issues: deduplicateIssues([...protocolReport.issues, ...implementationIssues]),
    summary: summarize(findings),
  };
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
        const { findings, issues, summary } = await runConsistencyCheck(ipCoreUri, resourceRoots);

        if (issues.length === 0) {
          void vscode.window.showInformationMessage(
            `IPCraft: ${path.basename(ipCoreUri.fsPath)} is consistent with its implementation.`
          );
          return;
        }

        ch.clear();
        ch.appendLine(`IPCraft consistency check — ${path.basename(ipCoreUri.fsPath)}`);
        ch.appendLine(
          `${issues.length} issue(s): ${summary.added} added, ${summary.removed} removed, ` +
            `${summary.changed} changed, ${summary.ambiguous} ambiguous.`
        );
        for (const issue of issues.filter((issue) => issue.source === 'protocol')) {
          ch.appendLine(
            `  [${issue.severity}/${issue.code}] .ip.yml:${issue.path.join('.')} — ${issue.message}`
          );
        }
        for (const finding of findings) {
          ch.appendLine(formatFinding(finding));
        }
        ch.show();

        // An ambiguity finding means no interface comparison happened at all — it's not
        // evidence of drift, so it shouldn't read as one (issue #161's "informational" ask). Only
        // warn about actual inconsistencies; when every finding is ambiguity-only, say so plainly.
        const hasNonAmbiguous =
          issues.some((issue) => issue.source === 'protocol') ||
          findings.some((f) => !AMBIGUOUS_KINDS.has(f.kind));
        if (hasNonAmbiguous) {
          void vscode.window.showWarningMessage(
            `IPCraft: found ${issues.length} issue${issues.length === 1 ? '' : 's'} ` +
              `between the .ip.yml and its implementation. See "IPCraft Consistency Check" output.`
          );
        } else {
          void vscode.window.showInformationMessage(
            `IPCraft: could not uniquely identify the top-level HDL implementation to check — ` +
              `see "IPCraft Consistency Check" output for details.`
          );
        }
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
