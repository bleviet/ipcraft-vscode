/**
 * VS Code Commands for VHDL Code Generation
 *
 * Provides commands to generate VHDL files from IP core definitions.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as YAML from "yaml";
import { Logger } from "../utils/Logger";
import { TemplateLoader } from "../generator/TemplateLoader";
import { IpCoreScaffolder } from "../generator/IpCoreScaffolder";
import { VhdlParser } from "../parser/VhdlParser";

const logger = new Logger("GenerateCommands");

/**
 * Register all generator commands with VS Code
 */
/**
 * Register a command, ignoring "already exists" errors that occur when the
 * extension host restarts without a full deactivation cycle.
 */
function safeRegisterCommand(
  context: vscode.ExtensionContext,
  command: string,
  handler: (...args: any[]) => any,
): void {
  try {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, handler),
    );
  } catch {
    // Command was already registered by a previous (stale) activation
  }
}

export function registerGeneratorCommands(
  context: vscode.ExtensionContext,
): void {
  // Generate VHDL command (auto-detects bus from YAML)
  safeRegisterCommand(context, "fpga-ip-core.generateVHDL", async () => {
    await generateVHDL(context);
  });

  // Legacy command - now just calls main generate
  safeRegisterCommand(context, "fpga-ip-core.generateVHDLWithBus", async () => {
    // Bus type is now auto-detected from YAML
    await generateVHDL(context);
  });

  // Parse VHDL and create IP core YAML
  safeRegisterCommand(context, "fpga-ip-core.parseVHDL", async (uri?: vscode.Uri) => {
    await parseVHDL(uri);
  });

  // View bundled bus definitions YAML
  safeRegisterCommand(context, "fpga-ip-core.viewBusDefinitions", async () => {
    await viewBusDefinitions(context);
  });
}

/**
 * Open the bundled bus_definitions.yml in a read-only editor tab
 */
async function viewBusDefinitions(
  context: vscode.ExtensionContext,
): Promise<void> {
  const builtInPath = path.join(
    context.extensionPath,
    "dist",
    "resources",
    "bus_definitions.yml",
  );

  const uri = vscode.Uri.file(builtInPath);

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
    });
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to open bus definitions: ${error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Get IP core file path from active editor
 */
function getActiveIpCoreFile(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage(
      "No active editor. Please open an IP core YAML file.",
    );
    return undefined;
  }

  const document = editor.document;
  if (
    !document.fileName.endsWith(".ip.yml") &&
    !document.fileName.endsWith(".ip.yaml")
  ) {
    vscode.window.showErrorMessage(
      "Active file is not an IP core file (*.ip.yml).",
    );
    return undefined;
  }

  return document.uri;
}

/**
 * Main VHDL generation command - requires Python backend
 */
async function generateVHDL(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const sourceDir = path.dirname(ipCoreUri.fsPath);
  const defaultOutputDir = path.join(sourceDir, "generated");

  // Ask user for output directory
  const outputUri = await vscode.window.showOpenDialog({
    defaultUri: vscode.Uri.file(defaultOutputDir),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Select Output Directory",
    title: "Select directory for generated VHDL files",
  });

  const outputDir = outputUri?.[0]?.fsPath || defaultOutputDir;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Generating VHDL files...",
      cancellable: false,
    },
    async () => {
      const generator = new IpCoreScaffolder(
        logger,
        new TemplateLoader(logger),
        context,
      );
      const result = await generator.generateAll(ipCoreUri.fsPath, outputDir, {
        updateYaml: true,
      });

      if (result.success) {
        if (result.files) {
          await updateFileSetsInYaml(
            ipCoreUri,
            outputDir,
            Object.keys(result.files),
          );
        }

        const action = await vscode.window.showInformationMessage(
          `✓ Generated ${result.count} files`,
          "Open Folder",
        );

        if (action === "Open Folder") {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(outputDir),
          );
        }
      } else {
        vscode.window.showErrorMessage(`Generation failed: ${result.error}`);
      }
    },
  );
}

/**
 * Parse VHDL file and generate IP core YAML
 */
async function parseVHDL(resourceUri?: vscode.Uri): Promise<void> {
  // Get VHDL file URI from context menu or active editor
  let vhdlUri = resourceUri;

  if (!vhdlUri) {
    const editor = vscode.window.activeTextEditor;
    if (
      editor &&
      (editor.document.fileName.endsWith(".vhd") ||
        editor.document.fileName.endsWith(".vhdl"))
    ) {
      vhdlUri = editor.document.uri;
    }
  }

  if (!vhdlUri) {
    // Show file picker
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { "VHDL Files": ["vhd", "vhdl"] },
      title: "Select VHDL file to parse",
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
      title: "Creating IP Core from VHDL...",
      cancellable: false,
    },
    async () => {
      try {
        const parser = new VhdlParser();
        const result = await parser.parseFile(vhdlPath, { detectBus: true });

        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(defaultOutput),
          encoder.encode(result.yamlText),
        );

        const action = await vscode.window.showInformationMessage(
          `✓ Created ${path.basename(defaultOutput)}`,
          "Open File",
        );

        if (action === "Open File") {
          const doc = await vscode.workspace.openTextDocument(defaultOutput);
          await vscode.window.showTextDocument(doc);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Parse failed: ${message}`);
      }
    },
  );
}

async function updateFileSetsInYaml(
  ipCoreUri: vscode.Uri,
  outputBaseDir: string,
  writtenFiles: string[],
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(ipCoreUri);
    const baseDir = path.dirname(ipCoreUri.fsPath);
    const doc = YAML.parseDocument(document.getText());
    const yamlRelativeFiles = writtenFiles.map((file) => {
      const absolutePath = path.join(outputBaseDir, file);
      return path.relative(baseDir, absolutePath);
    });

    const rtlFiles = yamlRelativeFiles.filter(
      (file) =>
        file.endsWith(".vhd") &&
        !file.endsWith("_regs.vhd") &&
        !file.endsWith("_tb.vhd"),
    );
    const simFiles = yamlRelativeFiles.filter(
      (file) =>
        file.endsWith(".py") ||
        file.endsWith("Makefile") ||
        file.endsWith("_tb.vhd"),
    );
    const integrationFiles = yamlRelativeFiles.filter(
      (file) =>
        file.endsWith(".tcl") ||
        file.endsWith(".xml") ||
        file.endsWith("_regs.vhd"),
    );

    const currentData = doc.toJSON();
    let fileSets = currentData.fileSets || currentData.file_sets || [];
    const key = currentData.fileSets
      ? "fileSets"
      : currentData.file_sets
        ? "file_sets"
        : "fileSets";

    if (!Array.isArray(fileSets)) {
      fileSets = [];
    }

    const updateFileSet = (
      setNames: string[],
      setDescription: string,
      newFiles: string[],
      fileTypeMap: (filePath: string) => string,
    ) => {
      if (newFiles.length === 0) {return;}

      let targetSetIndex = fileSets.findIndex(
        (fs: any) => fs && fs.name && setNames.includes(fs.name),
      );

      let usedName = setNames[0];

      if (targetSetIndex === -1) {
        fileSets.push({
          name: usedName,
          description: setDescription,
          files: [],
        });
        targetSetIndex = fileSets.length - 1;
      } else {
        usedName = fileSets[targetSetIndex].name;
      }

      if (!fileSets[targetSetIndex].files) {
        fileSets[targetSetIndex].files = [];
      }
      const existingFiles = fileSets[targetSetIndex].files;

      newFiles.forEach((filePath) => {
        const exists = existingFiles.some((f: any) => f.path === filePath);
        if (!exists) {
          existingFiles.push({
            path: filePath,
            type: fileTypeMap(filePath),
          });
        }
      });
    };

    updateFileSet(
      ["RTL_Sources", "rtl_sources", "rtl", "RTL"],
      "RTL Sources",
      rtlFiles,
      () => "vhdl",
    );
    updateFileSet(
      ["Simulation_Resources", "simulation", "tb"],
      "Simulation Files",
      simFiles,
      (file) => {
        if (file.endsWith("Makefile")) {return "unknown";}
        if (file.endsWith(".py")) {return "python";}
        return "vhdl";
      },
    );
    updateFileSet(
      ["Integration", "integration"],
      "Integration Files",
      integrationFiles,
      (file) => {
        if (file.endsWith(".tcl")) {return "tcl";}
        if (file.endsWith(".xml")) {return "unknown";}
        return "vhdl";
      },
    );

    doc.setIn([key], fileSets);
    const newText = doc.toString();
    const edit = new vscode.WorkspaceEdit();
    const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
      newText,
    );
    await vscode.workspace.applyEdit(edit);
    await document.save();
  } catch (error) {
    logger.error("Failed to update fileSets", error as Error);
  }
}
