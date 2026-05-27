import * as vscode from 'vscode';

async function openSettings(settingId: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
}

export async function vivadoNotConfiguredCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    "Vivado not found. Set 'ipcraft.vivado.installDir' to your Vivado installation directory " +
      '(e.g. /tools/Xilinx/Vivado/2024.2 or C:\\Xilinx\\2025.1\\Vivado). ' +
      'IPCraft will locate the vivado executable automatically.',
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft.vivado.installDir');
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
      'Quartus installation directory. IPCraft searches quartus/sopc_builder/bin for qsys-edit. ' +
      'Platform Designer opens with your generated component available in the IP catalog.',
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft.quartus.installDir');
  }
}

export async function buildNotConfiguredCommand(): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    'No build tools found. Configure at least one vendor tool: ' +
      "set 'ipcraft.vivado.installDir' for Vivado or 'ipcraft.quartus.installDir' for Quartus.",
    'Open Settings'
  );
  if (choice === 'Open Settings') {
    await openSettings('ipcraft');
  }
}
