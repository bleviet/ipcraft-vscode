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

/**
 * Extension activation entry point
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize logging
  Logger.initialize('FPGA Memory Map & IP Core Editor', LogLevel.INFO);
  const logger = new Logger('Extension');
  logger.info('Extension activating');

  // Register Memory Map custom editor provider
  try {
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(
        'fpgaMemoryMap.editor',
        new MemoryMapEditorProvider(context),
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
          supportsMultipleEditorsPerDocument: false,
        }
      )
    );
    logger.info('Memory Map editor registered');
  } catch (e) {
    logger.warn('fpgaMemoryMap.editor already registered – skipping');
  }

  // Register IP Core custom editor provider
  try {
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(
        'fpgaIpCore.editor',
        new IpCoreEditorProvider(context),
        {
          webviewOptions: {
            retainContextWhenHidden: true,
          },
          supportsMultipleEditorsPerDocument: false,
        }
      )
    );
    logger.info('IP Core editor registered');
  } catch (e) {
    logger.warn('fpgaIpCore.editor already registered – skipping');
  }

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
