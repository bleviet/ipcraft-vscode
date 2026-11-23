import * as vscode from 'vscode';
import { hoverKindOf, packetFileDiagnostics, packetHover } from '../shared/packetFormat';
import { readFromDisk } from '../services/packetFormat/refInfo';

const SELECTOR: vscode.DocumentSelector = [
  { pattern: '**/*.ip.yml' },
  { pattern: '**/*.pkt.yml' },
  { pattern: '**/*.pktmap.yml' },
];

/** Reads open documents before disk so unsaved edits of imported formats count. */
function readerWithOpenDocuments(): (p: string) => string | undefined {
  return (p) => {
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.scheme === 'file' && d.uri.fsPath === p
    );
    return open ? open.getText() : readFromDisk(p);
  };
}

const posix = (p: string): string => p.replace(/\\/g, '/');

function hoverFor(
  document: vscode.TextDocument,
  position: vscode.Position
): vscode.Hover | undefined {
  const kind = hoverKindOf(document.fileName);
  if (!kind) {
    return undefined;
  }
  const read = readerWithOpenDocuments();
  const hover = packetHover(
    kind,
    posix(document.fileName),
    document.getText(),
    position.line,
    (p) => read(p)
  );
  if (!hover) {
    return undefined;
  }
  const md = new vscode.MarkdownString(hover.markdown, true);
  const range = new vscode.Range(
    hover.startLine,
    0,
    hover.endLine,
    document.lineAt(Math.min(hover.endLine, document.lineCount - 1)).text.length
  );
  return new vscode.Hover(md, range);
}

function diagnose(document: vscode.TextDocument, collection: vscode.DiagnosticCollection): void {
  const kind = hoverKindOf(document.fileName);
  if (kind !== 'pkt' && kind !== 'pktmap') {
    return;
  }
  const items = packetFileDiagnostics(
    posix(document.fileName),
    document.getText(),
    readerWithOpenDocuments()
  );
  collection.set(
    document.uri,
    items.map((d) => {
      const last = Math.min(d.endLine, document.lineCount - 1);
      const range = new vscode.Range(d.startLine, 0, last, document.lineAt(last).text.length);
      const diagnostic = new vscode.Diagnostic(range, d.message, vscode.DiagnosticSeverity.Error);
      diagnostic.code = d.code;
      diagnostic.source = 'ipcraft packet format';
      return diagnostic;
    })
  );
}

/** Hovers for `.ip.yml` / `.pkt.yml` / `.pktmap.yml` and semantic diagnostics for the latter two. */
export function registerPacketFormatLanguage(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection('ipcraft-packet-format');
  const refreshAll = (): void =>
    vscode.workspace.textDocuments.forEach((d) => diagnose(d, collection));
  context.subscriptions.push(
    collection,
    vscode.languages.registerHoverProvider(SELECTOR, { provideHover: hoverFor }),
    vscode.workspace.onDidOpenTextDocument((d) => diagnose(d, collection)),
    // Edits of an imported file change results elsewhere, so every open packet file is re-checked.
    vscode.workspace.onDidChangeTextDocument(refreshAll),
    vscode.workspace.onDidSaveTextDocument(refreshAll),
    vscode.workspace.onDidCloseTextDocument((d) => collection.delete(d.uri))
  );
  refreshAll();
}
