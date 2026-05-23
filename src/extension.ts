import * as vscode from 'vscode';
import { Logger, LogLevel } from './utils/Logger';
import { MemoryMapEditorProvider } from './providers/MemoryMapEditorProvider';
import { IpCoreEditorProvider } from './providers/IpCoreEditorProvider';
import { ReportsTreeProvider } from './providers/ReportsTreeProvider';
import {
  createIpCoreCommand,
  createMemoryMapCommand,
  createIpCoreWithMemoryMapCommand,
} from './commands/FileCreationCommands';
import { registerGeneratorCommands } from './commands/GenerateCommands';
import { registerBuildCommands } from './commands/BuildCommands';
import { editInIpPackagerCommand } from './commands/editInIpPackager';
import { editInPlatformDesignerCommand } from './commands/editInPlatformDesigner';
import { openInVivadoCommand } from './commands/openInVivado';
import { openInQuartusCommand } from './commands/openInQuartus';
import { scanVivadoCatalogCommand } from './commands/scanVivadoCatalog';
import { openAsTextCommand, openAsVisualCommand } from './commands/toggleEditorMode';
import { IpCoreSourcePreviewProvider } from './providers/IpCoreSourcePreviewProvider';
import { safeRegisterCommand } from './utils/vscodeHelpers';
import { detectAndSetToolContext } from './services/ToolDetector';
import {
  vivadoNotConfiguredCommand,
  quartusNotConfiguredCommand,
  qsysEditNotConfiguredCommand,
  buildNotConfiguredCommand,
} from './commands/toolNotConfigured';

const SHARED_EDITOR_OPTIONS = {
  webviewOptions: {
    retainContextWhenHidden: true,
  },
  supportsMultipleEditorsPerDocument: false,
};

function registerCustomProvider(
  context: vscode.ExtensionContext,
  logger: Logger,
  viewType: string,
  provider: vscode.CustomTextEditorProvider,
  label: string
): void {
  try {
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(viewType, provider, SHARED_EDITOR_OPTIONS)
    );
    logger.info(`${label} editor registered`);
  } catch {
    logger.warn(`${viewType} already registered – skipping`);
  }
}

/**
 * Extension activation entry point
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize logging
  Logger.initialize('FPGA Memory Map & IP Core Editor', LogLevel.INFO);
  const logger = new Logger('Extension');
  logger.info('Extension activating');

  registerCustomProvider(
    context,
    logger,
    'fpgaMemoryMap.editor',
    new MemoryMapEditorProvider(context),
    'Memory Map'
  );

  registerCustomProvider(
    context,
    logger,
    'fpgaIpCore.editor',
    new IpCoreEditorProvider(context),
    'IP Core'
  );

  registerCustomProvider(
    context,
    logger,
    'fpgaIpCore.sourcePreview',
    new IpCoreSourcePreviewProvider(context),
    'IP Core Source Preview'
  );

  // Register File Creation Commands
  safeRegisterCommand(context, 'fpga-ip-core.createIpCore', createIpCoreCommand);
  safeRegisterCommand(context, 'fpga-ip-core.createMemoryMap', createMemoryMapCommand);
  safeRegisterCommand(
    context,
    'fpga-ip-core.createIpCoreWithMemoryMap',
    createIpCoreWithMemoryMapCommand
  );
  safeRegisterCommand(context, 'fpga-ip-core.editInIpPackager', editInIpPackagerCommand);
  safeRegisterCommand(
    context,
    'fpga-ip-core.editInPlatformDesigner',
    editInPlatformDesignerCommand
  );
  safeRegisterCommand(context, 'fpga-ip-core.openInVivado', openInVivadoCommand);
  safeRegisterCommand(context, 'fpga-ip-core.openInQuartus', openInQuartusCommand);
  safeRegisterCommand(context, 'fpga-ip-core.scanVivadoCatalog', scanVivadoCatalogCommand);
  safeRegisterCommand(context, 'fpga-ip-core.vivadoNotConfigured', vivadoNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.quartusNotConfigured', quartusNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.qsysEditNotConfigured', qsysEditNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.buildNotConfigured', buildNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.openAsText', openAsTextCommand);
  safeRegisterCommand(context, 'fpga-ip-core.openAsVisual', openAsVisualCommand);
  safeRegisterCommand(context, 'fpga-ip-core.previewInIpcraft', async (uri?: vscode.Uri) => {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', targetUri, 'fpgaIpCore.sourcePreview');
  });

  // Register VHDL Generator Commands
  registerGeneratorCommands(context);
  logger.info('Generator commands registered');

  // Register Build Commands + Reports tree view
  const reportsProvider = new ReportsTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fpga-ip-core.reportsView', reportsProvider)
  );

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.text = '$(circuit-board) IPCraft';
  statusBarItem.command = 'fpga-ip-core.showBuildOutput';
  statusBarItem.tooltip = 'IPCraft: Click to show build output';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  registerBuildCommands(context, reportsProvider, statusBarItem);
  logger.info('Build commands registered');

  // Install custom IPCraft bus definitions (e.g. Avalon Streaming) to the global OS config dir
  void import('./generator/VivadoBusDefInstaller').then(({ installGlobalBusDefinitions }) => {
    installGlobalBusDefinitions(context.extensionPath)
      .then((busDefsDir) => {
        logger.info(`Installed global bus definitions to: ${busDefsDir}`);

        // Show a one-time message if it's the first time we install, or let the user know.
        // We'll just log it to avoid spamming the user on every startup, but we could add a VS Code setting later
        // to track if the message has been shown.
        // For now, let's just show an info message that auto-dismisses or requires user to check output.
        // Actually, let's just log it. The user requested they be stored there.
      })
      .catch((err) => {
        logger.error(`Failed to install global bus definitions: ${err}`);
      });
  });

  // Probe for vendor tools and set context keys (controls command greying)
  detectAndSetToolContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('ipcraft.vivado.installDir') ||
        e.affectsConfiguration('ipcraft.vivadoPath') ||
        e.affectsConfiguration('ipcraft.quartus.installDir')
      ) {
        detectAndSetToolContext();
      }
    })
  );

  logger.info('Extension activated successfully');
}

/**
 * Extension deactivation cleanup
 */
export function deactivate(): void {
  const logger = new Logger('Extension');
  logger.info('Extension deactivating');
  Logger.dispose();
}
