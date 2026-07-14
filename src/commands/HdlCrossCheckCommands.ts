/**
 * VS Code command surfacing hdlCrossCheck as a headless-friendly check: cross-references a
 * .ip.yml's declared ports/clocks/resets/parameters against the top-level entity/module of
 * every HDL file its fileSets mark managed:false (issue #74).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { ResourceRoots } from '../services/ResourceRoots';
import { loadIpCoreData } from '../generator/loadIpCore';
import {
  crossCheckIpCoreAgainstHdl,
  HdlCrossCheckFinding,
} from '../generator/validation/hdlCrossCheck';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { getActiveIpCoreFile } from './GenerateCommands';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

const logger = new Logger('HdlCrossCheckCommands');

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('IPCraft HDL Consistency');
  return outputChannel;
}

function formatFinding(finding: HdlCrossCheckFinding): string {
  const yamlLocation = finding.ipYmlPath.join('.');
  return `  [${finding.kind}] .ip.yml:${yamlLocation} — ${finding.message}`;
}

export async function runHdlCrossCheck(
  ipCoreUri: vscode.Uri,
  resourceRoots: ResourceRoots
): Promise<HdlCrossCheckFinding[]> {
  const ipCoreData = await loadIpCoreData(ipCoreUri.fsPath, resourceRoots);
  return crossCheckIpCoreAgainstHdl(ipCoreData, path.dirname(ipCoreUri.fsPath));
}

export function registerHdlCrossCheckCommands(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots
): void {
  safeRegisterCommand(
    context,
    'fpga-ip-core.checkHdlConsistency',
    async (resourceUri?: vscode.Uri) => {
      const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
      if (!ipCoreUri) {
        return;
      }

      const ch = getOutputChannel();
      try {
        const findings = await runHdlCrossCheck(ipCoreUri, resourceRoots);

        if (findings.length === 0) {
          void vscode.window.showInformationMessage(
            `IPCraft: no inconsistencies found between ${path.basename(ipCoreUri.fsPath)} and its managed:false HDL.`
          );
          return;
        }

        ch.clear();
        ch.appendLine(`IPCraft HDL consistency check — ${path.basename(ipCoreUri.fsPath)}`);
        ch.appendLine(`${findings.length} finding(s):`);
        for (const finding of findings) {
          ch.appendLine(formatFinding(finding));
        }
        ch.show();
        void vscode.window.showWarningMessage(
          `IPCraft: found ${findings.length} inconsistenc${findings.length === 1 ? 'y' : 'ies'} between the .ip.yml and its managed:false HDL. See "IPCraft HDL Consistency" output.`
        );
      } catch (error) {
        logger.error('HDL consistency check failed', error as Error);
        void handleErrorWithUserNotification(
          error,
          'checkHdlConsistency',
          `HDL consistency check failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
