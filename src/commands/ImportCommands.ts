import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';
import { parseVhdlFile } from '../parser/VhdlParser';
import { parseHwTclFile } from '../parser/HwTclParser';
import { parseComponentXmlFile } from '../parser/ComponentXmlParser';
import { resolveVendor } from '../utils/resolveVendor';
import { rebaseIpYamlPaths } from '../utils/rebaseYamlPaths';
import { writeImportedFile, describeOutcome } from '../utils/importWrite';
import { EDITOR_VIEW_TYPE_IP_CORE } from '../utils/editorViewTypes';
import { CONFIG_KEY_IPCRAFT_IMPORT } from '../utils/configKeys';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

const HIDE_EXPERIMENTAL_IMPORT_WARNING = 'ipcraft.hideExperimentalImportWarning';

/**
 * Show a one-time dismissable warning before experimental parse/import operations.
 * Returns true when the caller should proceed, false when the user cancelled.
 */
async function showExperimentalParseWarning(context: vscode.ExtensionContext): Promise<boolean> {
  if (context.globalState.get<boolean>(HIDE_EXPERIMENTAL_IMPORT_WARNING)) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    'This import feature is experimental. Results may be incomplete or require manual ' +
      'adjustments for complex files. Review the generated .ip.yml before using it for code generation.',
    'Continue',
    "Don't show again",
    'Cancel'
  );
  if (!choice || choice === 'Cancel') {
    return false;
  }
  if (choice === "Don't show again") {
    void context.globalState.update(HIDE_EXPERIMENTAL_IMPORT_WARNING, true);
  }
  return true;
}

/**
 * Build a human-readable summary of what was detected in a parsed .ip.yml YAML string.
 */
export function buildParseSummary(yamlText: string): string {
  try {
    const data = YAML.parse(yamlText) as Record<string, unknown>;
    const name = String((data.name as string | undefined) ?? '');
    const ports = Array.isArray(data.ports) ? data.ports.length : 0;
    const params = Array.isArray(data.parameters) ? data.parameters.length : 0;
    const buses = Array.isArray(data.busInterfaces) ? data.busInterfaces.length : 0;
    const parts: string[] = [];
    if (ports > 0) {
      parts.push(`${ports} port${ports !== 1 ? 's' : ''}`);
    }
    if (params > 0) {
      parts.push(`${params} parameter${params !== 1 ? 's' : ''}`);
    }
    if (buses > 0) {
      parts.push(`${buses} bus interface${buses !== 1 ? 's' : ''}`);
    }
    const detail = parts.length > 0 ? parts.join(', ') : 'no items detected';
    return name ? `${name}: ${detail}` : detail;
  } catch {
    // YAML parse or data access error in a UI description helper — return empty string.
    return '';
  }
}

/**
 * Parse VHDL file and generate IP core YAML
 */
export async function parseVHDL(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  if (!(await showExperimentalParseWarning(context))) {
    return;
  }

  // Get VHDL file URI from context menu or active editor
  let vhdlUri = resourceUri;

  if (!vhdlUri) {
    const editor = vscode.window.activeTextEditor;
    if (
      editor &&
      (editor.document.fileName.endsWith('.vhd') || editor.document.fileName.endsWith('.vhdl'))
    ) {
      vhdlUri = editor.document.uri;
    }
  }

  if (!vhdlUri) {
    // Show file picker
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'VHDL Files': ['vhd', 'vhdl'] },
      title: 'Select VHDL file to parse',
    });
    vhdlUri = files?.[0];
  }

  if (!vhdlUri) {
    return;
  }

  // Generate output path (.ip.yml next to .vhd)
  const vhdlPath = vhdlUri.fsPath;
  const baseName = path.basename(vhdlPath, path.extname(vhdlPath));
  const outputDir = path.dirname(vhdlPath);
  const defaultOutput = path.join(outputDir, `${baseName}.ip.yml`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating IP Core from VHDL...',
      cancellable: false,
    },
    async () => {
      try {
        const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_IMPORT);
        const result = await parseVhdlFile(vhdlPath, {
          detectBus: true,
          vendor: cfg.get<string>('vendor'),
          library: cfg.get<string>('library'),
          version: cfg.get<string>('version'),
        });

        if (result.warnings && result.warnings.length > 0) {
          for (const warn of result.warnings) {
            void vscode.window.showWarningMessage(warn);
          }
        }

        const outcome = await writeImportedFile(vscode.Uri.file(defaultOutput), result.yamlText);

        const summary = buildParseSummary(result.yamlText);
        void vscode.window.showInformationMessage(
          `Imported (experimental) — ${summary ? `${summary}; ` : ''}${describeOutcome(path.basename(defaultOutput), outcome)}. Review the .ip.yml carefully before generating code.`
        );

        // 'merged' means the merge editor is now open on this file; opening the
        // custom visual editor would replace it before the user can resolve.
        if (outcome !== 'merged') {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.file(defaultOutput),
            EDITOR_VIEW_TYPE_IP_CORE
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void handleErrorWithUserNotification(error, 'parseVhdl', `Parse failed: ${message}`);
      }
    }
  );
}

/**
 * Parse Platform Designer _hw.tcl file and generate IP core YAML
 */
export async function parseHwTcl(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  if (!(await showExperimentalParseWarning(context))) {
    return;
  }

  let tclUri = resourceUri;

  if (!tclUri) {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.fileName.endsWith('.tcl')) {
      tclUri = editor.document.uri;
    }
  }

  if (!tclUri) {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'Platform Designer Component': ['tcl'] },
      title: 'Select Platform Designer _hw.tcl file',
    });
    tclUri = files?.[0];
  }

  if (!tclUri) {
    return;
  }

  const tclPath = tclUri.fsPath;
  const baseName = path
    .basename(tclPath)
    .replace(/_hw\.tcl$/i, '')
    .replace(/\.tcl$/i, '');
  const outputDir = path.dirname(tclPath);
  const outputPath = path.join(outputDir, `${baseName}.ip.yml`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Importing from Platform Designer component...',
      cancellable: false,
    },
    async () => {
      try {
        const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_IMPORT);
        const result = await parseHwTclFile(tclPath, {
          library: cfg.get<string>('library'),
          vendor: resolveVendor(cfg.get<string>('vendor')),
        });

        const outcome = await writeImportedFile(vscode.Uri.file(outputPath), result.yamlText);

        const summary = buildParseSummary(result.yamlText);
        void vscode.window.showInformationMessage(
          `Imported (experimental) — ${summary ? `${summary}; ` : ''}${describeOutcome(path.basename(outputPath), outcome)}. Review the .ip.yml carefully before generating code.`
        );

        // 'merged' means the merge editor is now open on this file; opening the
        // custom visual editor would replace it before the user can resolve.
        if (outcome !== 'merged') {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.file(outputPath),
            EDITOR_VIEW_TYPE_IP_CORE
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void handleErrorWithUserNotification(error, 'parseHwTcl', `Import failed: ${message}`);
      }
    }
  );
}

export async function parseComponentXml(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  if (!(await showExperimentalParseWarning(context))) {
    return;
  }

  let xmlUri = resourceUri;

  if (!xmlUri) {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.fileName.endsWith('component.xml')) {
      xmlUri = editor.document.uri;
    }
  }

  if (!xmlUri) {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'Vivado IP-XACT Component': ['xml'] },
      title: 'Select Xilinx component.xml file',
    });
    xmlUri = files?.[0];
  }

  if (!xmlUri) {
    return;
  }

  const xmlPath = xmlUri.fsPath;
  const xmlDir = path.dirname(xmlPath);

  // component.xml typically lives inside a vendor subdirectory (e.g. xilinx/).
  // Save the ip.yml one level up so that subsequent generation places xilinx/
  // and altera/ correctly relative to the project root.  Rebase fileset paths
  // from xmlDir to the parent so they remain valid relative to ip.yml.
  const VENDOR_SUBDIRS = new Set(['xilinx', 'altera']);
  const isVendorSubdir = VENDOR_SUBDIRS.has(path.basename(xmlDir).toLowerCase());
  const outputDir = isVendorSubdir ? path.dirname(xmlDir) : xmlDir;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Importing from Xilinx component.xml...',
      cancellable: false,
    },
    async () => {
      try {
        const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_IMPORT);
        const result = await parseComponentXmlFile(xmlPath, {
          library: cfg.get<string>('library'),
        });

        const ipYamlText =
          isVendorSubdir && outputDir !== xmlDir
            ? rebaseIpYamlPaths(result.ipYamlText, xmlDir, outputDir)
            : result.ipYamlText;
        const ipFileName = `${result.componentName}.ip.yml`;
        const ipOutputPath = path.join(outputDir, ipFileName);
        const ipOutcome = await writeImportedFile(vscode.Uri.file(ipOutputPath), ipYamlText);

        const ipSummary = buildParseSummary(ipYamlText);

        // Write the memory map file alongside, if the component carried registers.
        const outcomes = [describeOutcome(ipFileName, ipOutcome)];
        if (result.mmYamlText && result.mmFileName) {
          const mmOutputPath = path.join(outputDir, result.mmFileName);
          const mmOutcome = await writeImportedFile(
            vscode.Uri.file(mmOutputPath),
            result.mmYamlText
          );
          outcomes.push(describeOutcome(result.mmFileName, mmOutcome));
        }

        void vscode.window.showInformationMessage(
          `Imported (experimental) — ${ipSummary ? `${ipSummary}; ` : ''}${outcomes.join(', ')}. Review carefully before generating code.`
        );

        // 'merged' means the merge editor is now open on the .ip.yml; opening the
        // custom visual editor would replace it before the user can resolve.
        if (ipOutcome !== 'merged') {
          await vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.file(ipOutputPath),
            EDITOR_VIEW_TYPE_IP_CORE
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void handleErrorWithUserNotification(
          error,
          'parseComponentXml',
          `Import failed: ${message}`
        );
      }
    }
  );
}
