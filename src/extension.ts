import * as vscode from 'vscode';
import * as path from 'path';
import { Logger, LogLevel } from './utils/Logger';
import { MemoryMapEditorProvider } from './providers/MemoryMapEditorProvider';
import { IpCoreEditorProvider } from './providers/IpCoreEditorProvider';
import { resolveResourceRoots, ResourceRoots } from './services/ResourceRoots';
import { ReportsTreeProvider } from './providers/ReportsTreeProvider';
import { IpCoreTreeDataProvider } from './sidebar/IpCoreTreeDataProvider';
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
import { scanVivadoInterfacesCommand } from './commands/scanVivadoInterfaces';
import { scanWorkspaceBusDefinitionsCommand } from './commands/scanWorkspaceBusDefinitions';
import { openAsTextCommand, openAsVisualCommand } from './commands/toggleEditorMode';
import { IpCoreSourcePreviewProvider } from './providers/IpCoreSourcePreviewProvider';
import { safeRegisterCommand } from './utils/vscodeHelpers';
import { detectAndSetToolContext } from './services/ToolDetector';
import {
  migrateLegacyIpCoreCommand,
  checkForLegacyIpYmlFiles,
} from './commands/migrateLegacyIpCore';
import {
  copyComponentInstanceCommand,
  copyComponentInstanceDoneCommand,
} from './commands/copyComponentInstance';
import {
  vivadoNotConfiguredCommand,
  quartusNotConfiguredCommand,
  qsysEditNotConfiguredCommand,
  buildNotConfiguredCommand,
} from './commands/toolNotConfigured';
import { STAGING_SCHEME, stagingContentProvider } from './providers/StagingContentProvider';
import {
  TemplatePreviewProvider,
  TEMPLATE_PREVIEW_SCHEME,
} from './providers/TemplatePreviewProvider';
import { ScaffoldPackPanel } from './providers/ScaffoldPackPanel';
import { registerScaffoldPackCommands } from './commands/ScaffoldPackCommands';

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

  // Resolve resource roots at activation
  let resourceRoots: ResourceRoots;
  try {
    resourceRoots = resolveResourceRoots(context.extensionPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to resolve resource roots: ' + message);
    void vscode.window.showErrorMessage('IPCraft extension activation failed: ' + message);
    return;
  }

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
    new IpCoreEditorProvider(context, resourceRoots),
    'IP Core'
  );

  registerCustomProvider(
    context,
    logger,
    'fpgaIpCore.sourcePreview',
    new IpCoreSourcePreviewProvider(context, resourceRoots),
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
  safeRegisterCommand(context, 'fpga-ip-core.scanVivadoInterfaces', scanVivadoInterfacesCommand);
  safeRegisterCommand(
    context,
    'fpga-ip-core.scanWorkspaceBusDefinitions',
    scanWorkspaceBusDefinitionsCommand
  );
  safeRegisterCommand(context, 'fpga-ip-core.vivadoNotConfigured', vivadoNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.quartusNotConfigured', quartusNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.qsysEditNotConfigured', qsysEditNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.buildNotConfigured', buildNotConfiguredCommand);
  safeRegisterCommand(context, 'fpga-ip-core.openAsText', openAsTextCommand);
  safeRegisterCommand(context, 'fpga-ip-core.openAsVisual', openAsVisualCommand);
  safeRegisterCommand(context, 'fpga-ip-core.migrateLegacy', migrateLegacyIpCoreCommand);
  safeRegisterCommand(context, 'fpga-ip-core.previewInIpcraft', async (uri?: vscode.Uri) => {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', targetUri, 'fpgaIpCore.sourcePreview');
  });
  safeRegisterCommand(context, 'fpga-ip-core.copyComponentInstance', copyComponentInstanceCommand);
  safeRegisterCommand(
    context,
    'fpga-ip-core.copyComponentInstanceDone',
    copyComponentInstanceDoneCommand
  );

  // Register virtual document provider for staging diff previews
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(STAGING_SCHEME, stagingContentProvider)
  );

  // Register virtual document provider for .j2 template live preview
  const templatePreviewProvider = new TemplatePreviewProvider(logger, context, resourceRoots);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      TEMPLATE_PREVIEW_SCHEME,
      templatePreviewProvider
    )
  );

  // Scaffold.yml file-open handler — show the scaffold pack panel automatically
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      if (editor && path.basename(editor.document.fileName) === 'scaffold.yml') {
        const panel = ScaffoldPackPanel.show(logger, context, resourceRoots);
        await panel.refresh(editor.document.fileName);
      }
    })
  );

  // Register Scaffold Pack Commands (preview + export + watchers)
  registerScaffoldPackCommands(context, templatePreviewProvider, resourceRoots);

  // Register VHDL Generator Commands
  registerGeneratorCommands(context, resourceRoots);
  logger.info('Generator commands registered');

  // Register Build Commands + Reports tree view
  const reportsProvider = new ReportsTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fpga-ip-core.reportsView', reportsProvider)
  );

  // Register IPCraft Foundry Navigator tree view
  const foundryNavigatorProvider = new IpCoreTreeDataProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ipcraft-foundry.navigator', foundryNavigatorProvider)
  );
  context.subscriptions.push(foundryNavigatorProvider);

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusBarItem.text = '$(circuit-board) IPCraft';
  statusBarItem.command = 'fpga-ip-core.showBuildOutput';
  statusBarItem.tooltip = 'IPCraft: Click to show build output';
  context.subscriptions.push(statusBarItem);

  const FPGA_EXTENSIONS = new Set(['.v', '.sv', '.vhd', '.vhdl', '.ip.yml', '.mm.yml']);
  const isFpgaFile = (uri: vscode.Uri | undefined): boolean => {
    if (!uri) {
      return false;
    }
    const base = path.basename(uri.fsPath);
    // Match compound extensions (.ip.yml, .mm.yml) first, then simple ones.
    if (base.endsWith('.ip.yml') || base.endsWith('.mm.yml')) {
      return true;
    }
    return FPGA_EXTENSIONS.has(path.extname(base));
  };
  const refreshStatusBar = (uri: vscode.Uri | undefined) => {
    if (isFpgaFile(uri)) {
      statusBarItem.show();
    } else {
      statusBarItem.hide();
    }
  };
  refreshStatusBar(vscode.window.activeTextEditor?.document.uri);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => refreshStatusBar(editor?.document.uri))
  );

  registerBuildCommands(context, reportsProvider, statusBarItem);
  logger.info('Build commands registered');

  // Install custom IPCraft bus definitions (e.g. Avalon Streaming) to the global OS config dir
  void import('./generator/VivadoBusDefInstaller').then(({ installGlobalBusDefinitions }) => {
    installGlobalBusDefinitions(resourceRoots.busDefinitionsDir)
      .then((busDefsDir) => {
        logger.info(`Installed global bus definitions to: ${busDefsDir}`);
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
        e.affectsConfiguration('ipcraft.vivado.runner') ||
        e.affectsConfiguration('ipcraft.vivado.dockerImage') ||
        e.affectsConfiguration('ipcraft.quartus.installDir') ||
        e.affectsConfiguration('ipcraft.quartus.runner') ||
        e.affectsConfiguration('ipcraft.quartus.dockerImage')
      ) {
        detectAndSetToolContext();
      }
    })
  );

  // One-time notification if workspace contains legacy vendor: fields
  void checkForLegacyIpYmlFiles(context);

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
