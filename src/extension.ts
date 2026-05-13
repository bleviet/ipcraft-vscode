import * as vscode from 'vscode';
import { Logger, LogLevel } from './utils/Logger';
import { MemoryMapEditorProvider } from './providers/MemoryMapEditorProvider';
import { IpCoreEditorProvider } from './providers/IpCoreEditorProvider';
import {
  createIpCoreCommand,
  createMemoryMapCommand,
  createIpCoreWithMemoryMapCommand,
} from './commands/FileCreationCommands';
import { registerGeneratorCommands } from './commands/GenerateCommands';
import { editInIpPackagerCommand } from './commands/editInIpPackager';
import { scanVivadoCatalogCommand } from './commands/scanVivadoCatalog';
import { safeRegisterCommand } from './utils/vscodeHelpers';

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

  // Register File Creation Commands
  safeRegisterCommand(context, 'fpga-ip-core.createIpCore', createIpCoreCommand);
  safeRegisterCommand(context, 'fpga-ip-core.createMemoryMap', createMemoryMapCommand);
  safeRegisterCommand(
    context,
    'fpga-ip-core.createIpCoreWithMemoryMap',
    createIpCoreWithMemoryMapCommand
  );
  safeRegisterCommand(context, 'fpga-ip-core.editInIpPackager', editInIpPackagerCommand);
  safeRegisterCommand(context, 'fpga-ip-core.scanVivadoCatalog', scanVivadoCatalogCommand);

  // Register VHDL Generator Commands
  registerGeneratorCommands(context);
  logger.info('Generator commands registered');

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
