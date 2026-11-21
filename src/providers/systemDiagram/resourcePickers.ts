/** The file and folder dialogs that attach resource reports; each returns the file sets to attach. */

import * as path from 'path';
import * as vscode from 'vscode';
import type { SystemGraph } from '../../domain/systemGraph';
import {
  classifyReportFiles,
  type ReportCandidate,
} from '../../services/resources/reportCandidates';
import { discoverFolderReports } from '../../services/resources/reportDiscovery';

const filesOf = (candidate: ReportCandidate): string[] => [
  ...candidate.files,
  ...(candidate.capacityFile ? [candidate.capacityFile] : []),
];

/** Report files the user picks: one set per report (with its capacity file), one per checkpoint. */
export async function pickReportFiles(
  designFile: string,
  graph: SystemGraph
): Promise<string[][] | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: true,
    defaultUri: vscode.Uri.file(path.dirname(designFile)),
    filters: { Reports: ['rpt', 'summary', 'dcp'], 'All files': ['*'] },
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }
  const files = picked.map((uri) => uri.fsPath);
  const sets = (
    await classifyReportFiles(
      files.filter((f) => !f.endsWith('.dcp')),
      graph,
      { refusals: 'all' }
    )
  ).map(filesOf);
  return [...sets, ...files.filter((f) => f.endsWith('.dcp')).map((f) => [f])];
}

/** The usable reports below a folder the user picks; says so when there are none. */
export async function pickFolderReports(
  designFile: string,
  graph: SystemGraph
): Promise<string[][] | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    defaultUri: vscode.Uri.file(path.dirname(designFile)),
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }
  const found = await discoverFolderReports(picked[0].fsPath, graph);
  const usable = found.filter((candidate) => candidate.usable);
  if (usable.length === 0) {
    void vscode.window.showInformationMessage(
      `No usable resource report found in ${picked[0].fsPath}.${found[0]?.reason ? ` ${found[0].reason}` : ''}`
    );
    return undefined;
  }
  return usable.map(filesOf);
}
