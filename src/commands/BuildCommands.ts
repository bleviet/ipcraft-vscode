import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { BuildReports } from '../services/ReportParser';
import type { ReportsTreeProvider, BuildStatus } from '../providers/ReportsTreeProvider';
import type { IpCoreData } from '../generator/types';
import { listAll } from '../services/toolchains/registry';
import type { BuildMode } from '../services/toolchains/SynthesisToolchain';

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('IPCraft Build');
  return outputChannel;
}

/** Shared output channel used by both Build and Generate & Build commands. */
export function getBuildOutputChannel(): vscode.OutputChannel {
  return getOutputChannel();
}

function isIpCoreFile(fsPath: string): boolean {
  return fsPath.endsWith('.ip.yml') || fsPath.endsWith('.ip.yaml');
}

function getActiveIpCoreFile(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && isIpCoreFile(editor.document.fileName)) {
    return editor.document.uri;
  }
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab?.input instanceof vscode.TabInputCustom) {
    const { uri } = activeTab.input;
    if (isIpCoreFile(uri.fsPath)) {
      return uri;
    }
  }
  return undefined;
}

async function resolveIpCore(): Promise<
  { uri: vscode.Uri; name: string; dir: string } | undefined
> {
  let ipUri = getActiveIpCoreFile();

  if (!ipUri) {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'IP Core': ['yml', 'yaml'] },
      title: 'Select IP Core file (.ip.yml) to build',
    });
    const picked = files?.[0];
    if (!picked || !isIpCoreFile(picked.fsPath)) {
      return undefined;
    }
    ipUri = picked;
  }

  try {
    const raw = await vscode.workspace.fs.readFile(ipUri);
    const data = yaml.load(new TextDecoder().decode(raw)) as IpCoreData;
    const name = String(data?.vlnv?.name ?? '').toLowerCase();
    if (!name) {
      void vscode.window.showErrorMessage('Cannot read vlnv.name from IP core file.');
      return undefined;
    }
    return { uri: ipUri, name, dir: path.dirname(ipUri.fsPath) };
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Cannot read IP core: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
}

type BuildTarget = {
  label: string;
  description: string;
  run: () => Promise<BuildReports | undefined>;
};

async function detectTargets(name: string, ipDir: string): Promise<BuildTarget[]> {
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const ch = getOutputChannel();
  const targets: BuildTarget[] = [];

  for (const toolchain of listAll()) {
    const modes: BuildMode[] = await toolchain.detectBuildModes(name, ipDir, cfg, ch);
    for (const mode of modes) {
      targets.push({ label: mode.label, description: mode.description, run: mode.run });
    }
  }

  return targets;
}

function summaryText(reports: BuildReports[]): string {
  const first = reports[0];
  if (!first) {
    return 'Done';
  }
  if (first.vendor === 'vivado' && first.timing?.wns !== undefined) {
    const sign = first.timing.wns >= 0 ? '+' : '';
    return `WNS ${sign}${first.timing.wns.toFixed(2)}ns`;
  }
  if (first.vendor === 'quartus' && first.timing?.fmax !== undefined) {
    return `Fmax ${first.timing.fmax.toFixed(0)} MHz`;
  }
  return 'Done';
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  status: BuildStatus,
  reports: BuildReports[]
): void {
  switch (status) {
    case 'idle':
      item.text = '$(circuit-board) IPCraft';
      item.tooltip = 'IPCraft: Click to show build output';
      item.backgroundColor = undefined;
      break;
    case 'running':
      item.text = '$(loading~spin) Building…';
      item.tooltip = 'IPCraft: Build in progress';
      item.backgroundColor = undefined;
      break;
    case 'success': {
      const summary = summaryText(reports);
      item.text = `$(pass) ${summary}`;
      item.tooltip = `IPCraft: Last build passed — ${summary}`;
      item.backgroundColor = undefined;
      break;
    }
    case 'failed':
      item.text = '$(error) Build failed';
      item.tooltip = 'IPCraft: Last build failed — click to show output';
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      break;
  }
}

export function registerBuildCommands(
  context: vscode.ExtensionContext,
  treeProvider: ReportsTreeProvider,
  statusBarItem: vscode.StatusBarItem
): void {
  const setStatus = (status: BuildStatus, reports: BuildReports[] = []) => {
    treeProvider.update(status, reports);
    updateStatusBar(statusBarItem, status, reports);
  };

  const doRun = async (autoTargetLabel?: string) => {
    const ip = await resolveIpCore();
    if (!ip) {
      return;
    }

    const targets = await detectTargets(ip.name, ip.dir);

    if (targets.length === 0) {
      void vscode.window.showWarningMessage(
        'No build targets found. Run "IPCraft: Scaffold VHDL Project" first.'
      );
      return;
    }

    let picked: BuildTarget | undefined;
    if (autoTargetLabel) {
      picked = targets.find((t) => t.label === autoTargetLabel) ?? targets[0];
    } else if (targets.length === 1) {
      picked = targets[0];
    } else {
      const sel = await vscode.window.showQuickPick(
        targets.map((t) => ({ label: t.label, description: t.description, target: t })),
        { title: `Build ${ip.name}`, placeHolder: 'Select build target' }
      );
      picked = sel?.target;
    }
    if (!picked) {
      return;
    }

    const ch = getOutputChannel();
    ch.show(true);
    ch.appendLine(`\n${'='.repeat(60)}`);
    ch.appendLine(`IPCraft Build — ${picked.label}`);
    ch.appendLine(`IP Core : ${ip.name}`);
    ch.appendLine(`Dir     : ${ip.dir}`);
    ch.appendLine('='.repeat(60));

    setStatus('running');

    const reports = await picked.run();

    if (reports) {
      setStatus('success', [reports]);
    } else {
      setStatus('failed');
      void vscode.window.showErrorMessage('Build failed — see IPCraft Build output.');
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('fpga-ip-core.build', () => void doRun()),
    vscode.commands.registerCommand(
      'fpga-ip-core.buildVivadoOoc',
      () => void doRun('Vivado OOC Synthesis')
    ),
    vscode.commands.registerCommand(
      'fpga-ip-core.buildQuartusCompile',
      () => void doRun('Quartus Compile')
    ),
    vscode.commands.registerCommand('fpga-ip-core.showBuildOutput', () => getOutputChannel().show())
  );
}
