/**
 * The Assign Tcl gesture of a block design container: the user picks the Tcl
 * script that generates the container's block design, and the choice is stored
 * in the workspace's `.ipcraft/bd-links.json` (see `bdLinks.ts`).
 */

import * as path from 'path';
import * as vscode from 'vscode';
import { BD_EVIDENCE_TEXT, containerDesigns } from '../domain/bdContainer';
import type { SystemGraph } from '../domain/systemGraph';
import {
  BD_LINKS_FILE,
  formatBdLinks,
  isInside,
  linksForDesign,
  parseBdLinks,
  setBdLink,
  type BdLinksFile,
} from '../services/systemDiagram/enrichment/bdLinks';
import type { RankedBdTcl } from '../services/systemDiagram/enrichment/rankBdTcl';

type Choice = { kind: 'file'; file: string } | { kind: 'browse' } | { kind: 'remove' };
type ChoiceItem = vscode.QuickPickItem & { choice: Choice };

/** The file an instance's level was read from, as a path: the open design for the top levels. */
function designFileOf(graph: SystemGraph, instancePath: string, openDesign: string): string {
  const parent = graph.instances[instancePath].parent;
  const uri = graph.levels[parent]?.source?.uri;
  return uri === undefined ? openDesign : vscode.Uri.parse(uri).fsPath;
}

async function readLinks(folder: vscode.Uri): Promise<BdLinksFile | undefined> {
  let text: string;
  try {
    text = new TextDecoder().decode(
      await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, BD_LINKS_FILE))
    );
  } catch {
    return undefined;
  }
  return parseBdLinks(text);
}

/**
 * Asks for a Tcl script for the container at `instancePath` and writes the
 * link. Returns whether the links file changed.
 */
export async function assignContainerTcl(options: {
  graph: SystemGraph | undefined;
  instancePath: string;
  /** Path of the open design file. */
  openDesign: string;
  candidates: (designFile: string, bd: string) => Promise<RankedBdTcl<vscode.Uri>[]>;
}): Promise<boolean> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showErrorMessage('Trust this workspace to assign a Tcl script.');
    return false;
  }
  const { graph, instancePath, openDesign } = options;
  const instance = graph?.instances[instancePath];
  const designs = instance && containerDesigns(instance);
  if (!graph || !instance || !designs) {
    return false;
  }
  const designFile = designFileOf(graph, instancePath, openDesign);
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(designFile));
  if (!folder) {
    void vscode.window.showErrorMessage(
      'Open the design inside a workspace folder to assign a Tcl script.'
    );
    return false;
  }
  const root = folder.uri.fsPath;
  const bd = designs.active;
  let links: BdLinksFile | undefined;
  try {
    links = await readLinks(folder.uri);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `${BD_LINKS_FILE} is invalid; fix or delete it first: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
  const hasLink =
    links !== undefined && linksForDesign(links, root, designFile).links[bd] !== undefined;

  const current = instance.container?.source?.uri;
  const items: ChoiceItem[] = (await options.candidates(designFile, bd)).map(
    ({ entry, evidence }) => ({
      label: path.basename(entry.file),
      description: entry.uri === current ? `${entry.displayName} (current)` : entry.displayName,
      detail: BD_EVIDENCE_TEXT[evidence],
      choice: { kind: 'file', file: entry.file },
    })
  );
  items.push({ label: 'Browse…', choice: { kind: 'browse' } });
  if (hasLink) {
    items.push({ label: 'Remove assignment', choice: { kind: 'remove' } });
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: `Tcl script for block design ${bd}`,
    placeHolder: 'Choose the Tcl script that generates this block design',
  });
  if (!picked) {
    return false;
  }

  let tclFile: string | undefined;
  if (picked.choice.kind === 'file') {
    tclFile = picked.choice.file;
  } else if (picked.choice.kind === 'browse') {
    const chosen = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'Tcl scripts': ['tcl'] },
      defaultUri: vscode.Uri.file(path.dirname(designFile)),
    });
    if (!chosen?.[0]) {
      return false;
    }
    if (!isInside(root, chosen[0].fsPath)) {
      void vscode.window.showErrorMessage(
        'Choose a Tcl script inside the workspace folder of the design.'
      );
      return false;
    }
    tclFile = chosen[0].fsPath;
  }

  const target = vscode.Uri.joinPath(folder.uri, BD_LINKS_FILE);
  await vscode.workspace.fs.createDirectory(
    vscode.Uri.joinPath(folder.uri, path.dirname(BD_LINKS_FILE))
  );
  await vscode.workspace.fs.writeFile(
    target,
    new TextEncoder().encode(formatBdLinks(setBdLink(links, root, designFile, bd, tclFile)))
  );
  return true;
}
