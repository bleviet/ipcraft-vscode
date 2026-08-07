import * as vscode from 'vscode';

/**
 * Fired after a generate/export/vendor-project command successfully writes
 * artifacts for an `.ip.yml` (e.g. `xilinx/component.xml`, `altera/*_hw.tcl`,
 * a Vivado `.xpr`, or a Quartus `.qpf`).
 *
 * `IpCoreEditorProvider` subscribes per open document and refreshes its
 * webview's `hasHwTcl`/`hasComponentXml`/`hasXpr`/`hasQpf` toolbar state.
 * This exists because those commands can be invoked directly (Command
 * Palette, Explorer/editor-title context menu) without going through the
 * webview, and `watchGeneratedFiles`'s FS watcher is not a reliable signal
 * for files created inside a directory that did not exist a moment earlier.
 *
 * Module-level singleton, same shape as
 * `WorkspaceBusDefinitionScanner.onDidScan` — generator/vendor-project
 * command modules have no reference to any `IpCoreEditorProvider` instance.
 */
class GeneratedArtifactsEmitter {
  private readonly _onDidGenerate = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidGenerate = this._onDidGenerate.event;

  fire(ipCoreUri: vscode.Uri): void {
    this._onDidGenerate.fire(ipCoreUri);
  }
}

const generatedArtifactsEmitter = new GeneratedArtifactsEmitter();

export function getGeneratedArtifactsEmitter(): GeneratedArtifactsEmitter {
  return generatedArtifactsEmitter;
}
