import * as vscode from 'vscode';
import * as path from 'path';
import { ResourceRoots } from '../services/ResourceRoots';
import { pickVivadoPart, pickQuartusDevice } from '../utils/pickBoard';
import { getActiveIpCoreFile } from '../utils/activeIpCoreFile';
import { runGenerator, readScaffoldPackSetting } from '../services/GenerationEngine';
import { createVivadoProject, createQuartusProject } from './projectCreator';
import { getBuildOutputChannel } from '../services/BuildOutputChannel';
import {
  resolveToolchainVersionForCreate,
  resolveToolchainVersionForResource,
} from '../services/toolchains/resolveToolchainVersion';
import { CONFIG_KEY_IPCRAFT, CONFIG_KEY_IPCRAFT_GENERATE } from '../utils/configKeys';

/**
 * Run the Vivado project-creation step after Generate, showing a progress notification.
 * If Vivado is not found, shows an info message with manual instructions.
 */
export async function runCreateVivadoProjectStep(
  name: string,
  ipDir: string,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ch = getBuildOutputChannel();
  const cfg = vscode.workspace.getConfiguration(
    CONFIG_KEY_IPCRAFT,
    resourceUri ?? vscode.Uri.file(ipDir)
  );
  const choice = await resolveToolchainVersionForCreate(cfg, 'vivado');
  if (choice === undefined) {
    return;
  }
  let success = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating Vivado project (.xpr)…',
      cancellable: false,
    },
    async () => {
      success = await createVivadoProject(name, ipDir, ch, choice?.version, cfg);
    }
  );
  if (!success) {
    void vscode.window.showInformationMessage(
      `Vivado project TCL written. Run manually to create the .xpr:\n` +
        `  vivado -mode batch -source ${name}_project.tcl -nojournal -nolog\n` +
        `(from the xilinx/ directory)`
    );
  }
}

/**
 * Run the Quartus project-creation step after Generate, showing a progress notification.
 * If Quartus is not found, shows an info message with manual instructions.
 */
export async function runCreateQuartusProjectStep(
  name: string,
  ipDir: string,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ch = getBuildOutputChannel();
  const cfg = vscode.workspace.getConfiguration(
    CONFIG_KEY_IPCRAFT,
    resourceUri ?? vscode.Uri.file(ipDir)
  );
  const choice = await resolveToolchainVersionForCreate(cfg, 'quartus');
  if (choice === undefined) {
    return;
  }
  let success = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating Quartus project (.qpf)…',
      cancellable: false,
    },
    async () => {
      success = await createQuartusProject(name, ipDir, ch, choice?.version, cfg);
    }
  );
  if (!success) {
    void vscode.window.showInformationMessage(
      `Quartus project TCL written. Run manually to create the .qpf:\n` +
        `  quartus_sh -t ${name}_project.tcl\n` +
        `(from the altera/build/ directory)`
    );
  }
}

export async function generateVivadoProject(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, ipCoreUri);
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE, ipCoreUri);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const targetPart = await pickVivadoPart(
    context,
    cfg.get<string>('vivado.defaultPart', 'xc7z020clg484-1')
  );
  if (!targetPart) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  const name = path
    .basename(ipCoreUri.fsPath)
    .replace(/\.ip\.ya?ml$/, '')
    .toLowerCase();

  const ok = await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['vivado'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeVivadoProject: true,
      targetPart,
      scaffoldPack,
      silent: true,
    },
    'Generating Vivado project...'
  );

  if (ok) {
    await runCreateVivadoProjectStep(name, outputDir, ipCoreUri);
  }
}

export async function generateQuartusProject(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, ipCoreUri);
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE, ipCoreUri);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const quartusDevice = await pickQuartusDevice(
    context,
    cfg.get<string>('quartus.defaultDevice', '5CSEBA6U23I7')
  );
  if (!quartusDevice) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  const name = path
    .basename(ipCoreUri.fsPath)
    .replace(/\.ip\.ya?ml$/, '')
    .toLowerCase();

  const ok = await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeQuartusProject: true,
      quartusDevice,
      scaffoldPack,
      silent: true,
    },
    'Generating Quartus project...'
  );

  if (ok) {
    await runCreateQuartusProjectStep(name, outputDir, ipCoreUri);
  }
}

export async function generateAndBuildVivado(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, ipCoreUri);
  const choice = await resolveToolchainVersionForResource(cfg, 'vivado');
  if (choice === undefined) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const targetPart = await pickVivadoPart(
    context,
    cfg.get<string>('vivado.defaultPart', 'xc7z020clg484-1')
  );
  if (!targetPart) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  const ok = await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['vivado'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeVivadoProject: true,
      targetPart,
      scaffoldPack,
      silent: true,
    },
    'Generating Vivado project...'
  );

  if (ok) {
    await vscode.commands.executeCommand(
      'fpga-ip-core.buildVivadoOoc',
      ipCoreUri,
      choice?.version ?? null
    );
  }
}

export async function generateAndBuildQuartus(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, ipCoreUri);
  const choice = await resolveToolchainVersionForResource(cfg, 'quartus');
  if (choice === undefined) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const quartusDevice = await pickQuartusDevice(
    context,
    cfg.get<string>('quartus.defaultDevice', '5CSEBA6U23I7')
  );
  if (!quartusDevice) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  const ok = await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeQuartusProject: true,
      quartusDevice,
      scaffoldPack,
      silent: true,
    },
    'Generating Quartus project...'
  );

  if (ok) {
    await vscode.commands.executeCommand(
      'fpga-ip-core.buildQuartusCompile',
      ipCoreUri,
      choice?.version ?? null
    );
  }
}
