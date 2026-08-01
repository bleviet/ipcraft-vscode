import * as vscode from 'vscode';
import * as path from 'path';
import { ResourceRoots } from '../services/ResourceRoots';
import { pickVivadoPart, pickQuartusDevice } from '../utils/pickBoard';
import { getActiveIpCoreFile } from '../utils/activeIpCoreFile';
import { runGenerator, readScaffoldPackSetting } from '../services/GenerationEngine';
import { runCreateVivadoProjectStep, runCreateQuartusProjectStep } from './VendorProjectCommands';
import {
  CONFIG_KEY_IPCRAFT,
  CONFIG_KEY_IPCRAFT_GENERATE,
  CONFIG_KEY_IPCRAFT_TOOLBAR,
} from '../utils/configKeys';

export async function generateHdl(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const hdlLanguage = genCfg.get<'vhdl' | 'systemverilog'>('hdlLanguage', 'vhdl');
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const langLabel = hdlLanguage === 'systemverilog' ? 'SystemVerilog' : 'VHDL';
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: [],
      includeVhdl: true,
      includeRegs: true,
      includeTestbench: false,
      updateYaml: true,
      silent: true,
      hdlLanguage,
      scaffoldPack,
    },
    `Generating ${langLabel}...`
  );
}

export async function scaffoldProject(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const includeTestbench = genCfg.get<boolean>('includeTestbench', true);
  const includeDocs = genCfg.get<boolean>('includeDocs', true);
  const hdlLanguage = genCfg.get<'vhdl' | 'systemverilog'>('hdlLanguage', 'vhdl');
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  // Scaffold bundles the testbench, so honor the same framework/engine settings
  // the standalone 'Generate Testbench' button uses (see generateTestbench).
  const framework = cfg.get<string>('testbench.framework', 'cocotb');
  const engine = cfg.get<string>('testbench.engine', 'ghdl');

  const targets = vscode.workspace
    .getConfiguration(CONFIG_KEY_IPCRAFT_TOOLBAR)
    .get<string[]>('targets', ['vivado', 'quartus']);

  let targetPart: string | undefined;
  if (targets.includes('vivado')) {
    targetPart = await pickVivadoPart(
      context,
      cfg.get<string>('vivado.defaultPart', 'xc7z020clg484-1')
    );
    if (!targetPart) {
      return;
    }
  }

  let quartusDevice: string | undefined;
  if (targets.includes('quartus')) {
    quartusDevice = await pickQuartusDevice(
      context,
      cfg.get<string>('quartus.defaultDevice', '5CSEBA6U23I7')
    );
    if (!quartusDevice) {
      return;
    }
  }

  const ok = await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets,
      includeVhdl: true,
      includeRegs: true,
      includeTestbench,
      includeDocs,
      framework,
      engine,
      includeVivadoProject: targets.includes('vivado'),
      targetPart,
      includeQuartusProject: targets.includes('quartus'),
      quartusDevice,
      updateYaml: true,
      silent: true,
      hdlLanguage,
      scaffoldPack,
    },
    'Scaffolding project...'
  );

  if (ok) {
    const name = path
      .basename(ipCoreUri.fsPath)
      .replace(/\.ip\.ya?ml$/, '')
      .toLowerCase();
    // Sequential, not Promise.all: each step can open a version QuickPick, and
    // VS Code dismisses the first picker the moment the second one opens.
    if (targets.includes('vivado')) {
      await runCreateVivadoProjectStep(name, outputDir, ipCoreUri);
    }
    if (targets.includes('quartus')) {
      await runCreateQuartusProjectStep(name, outputDir, ipCoreUri);
    }
  }
}

export async function exportAltera(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      scaffoldPack,
      silent: true,
    },
    'Exporting Altera Platform Designer component...'
  );
}

export async function exportXilinx(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['vivado'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      scaffoldPack,
      silent: true,
    },
    'Exporting Xilinx Vivado component...'
  );
}

export async function generateTestbench(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const framework = cfg.get<string>('testbench.framework', 'cocotb');
  const engine = cfg.get<string>('testbench.engine', 'ghdl');
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: [],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: true,
      framework,
      engine,
      scaffoldPack,
      silent: true,
    },
    `Generating ${framework} testbench...`
  );
}

export async function generateDocumentation(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    resourceRoots,
    context,
    ipCoreUri,
    outputDir,
    {
      targets: [],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeDocs: true,
      scaffoldPack,
      silent: true,
    },
    'Generating documentation...'
  );
}
