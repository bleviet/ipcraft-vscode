import * as vscode from 'vscode';

async function openSettings(settingId: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
}

export async function vivadoNotConfiguredCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Vivado not found. Set 'ipcraft.vivadoPath' to the Vivado executable path " +
      '(e.g. /tools/Xilinx/Vivado/2024.2/bin/vivado). Leave empty to use vivado from PATH.',
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft.vivadoPath');
  }
}

export async function quartusNotConfiguredCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Quartus not found. Set 'ipcraft.quartus.installDir' to your Quartus installation directory " +
      '(e.g. /opt/intelFPGA_pro/23.1 or C:\\intelFPGA_pro\\23.1). ' +
      'IPCraft will locate quartus_sh and quartus automatically.',
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft.quartus.installDir');
  }
}

export async function qsysEditNotConfiguredCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Platform Designer (qsys-edit) not found. Set 'ipcraft.quartus.installDir' to your " +
      'Quartus installation directory. IPCraft searches quartus/sopc_builder/bin for qsys-edit.',
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft.quartus.installDir');
  }
}

export async function buildNotConfiguredCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    'No build tools found. Configure at least one vendor tool: ' +
      "set 'ipcraft.vivadoPath' for Vivado or 'ipcraft.quartus.installDir' for Quartus.",
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft');
  }
}
