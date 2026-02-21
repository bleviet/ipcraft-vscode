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

  // Register VHDL Generator Commands
  registerGeneratorCommands(context);
  logger.info('Generator commands registered');

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
