import * as vscode from 'vscode';
import { VIVADO_BOARDS, QUARTUS_BOARDS } from '../data/boardCatalog';

const LAST_VIVADO_KEY = 'ipcraft.lastVivadoPart';
const LAST_QUARTUS_KEY = 'ipcraft.lastQuartusDevice';

interface VivadoPickItem extends vscode.QuickPickItem {
  part?: string;
}

interface QuartusPickItem extends vscode.QuickPickItem {
  device?: string;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) {
      map.set(k, []);
    }
    map.get(k)!.push(item);
  }
  return map;
}

export async function pickVivadoPart(
  context: vscode.ExtensionContext,
  fallbackDefault?: string
): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const lastPart =
    context.globalState.get<string>(LAST_VIVADO_KEY) ?? fallbackDefault ?? 'xc7z020clg484-1';
  const customBoards = cfg.get<Array<{ label: string; part: string }>>('customBoards.vivado') ?? [];

  const items: VivadoPickItem[] = [];

  items.push({
    label: '$(edit) Enter custom part number…',
    alwaysShow: true,
  });

  if (customBoards.length > 0) {
    items.push({ label: 'My Boards', kind: vscode.QuickPickItemKind.Separator });
    for (const b of customBoards) {
      items.push({ label: b.label, description: b.part, part: b.part });
    }
  }

  // Show "last used" when it came from a manual entry not in the catalog
  const catalogParts = new Set(VIVADO_BOARDS.map((b) => b.part));
  const customParts = new Set(customBoards.map((b) => b.part));
  if (lastPart && !catalogParts.has(lastPart) && !customParts.has(lastPart)) {
    items.push({ label: 'Recently Used', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: lastPart, description: 'custom — last used', part: lastPart });
  }

  const groups = groupBy(VIVADO_BOARDS, (b) => b.vendor);
  for (const [vendor, boards] of groups) {
    items.push({ label: vendor, kind: vscode.QuickPickItemKind.Separator });
    for (const b of boards) {
      items.push({ label: b.label, description: b.part, detail: b.family, part: b.part });
    }
  }

  const picked = await vscode.window.showQuickPick<VivadoPickItem>(items, {
    title: 'Select Target FPGA Board — Vivado',
    placeHolder: 'Search by board name, part number, or family…',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return undefined;
  }

  if (picked.part) {
    await context.globalState.update(LAST_VIVADO_KEY, picked.part);
    return picked.part;
  }

  // "Enter custom part number…" chosen
  const manual = await vscode.window.showInputBox({
    title: 'Vivado — Custom Part Number',
    prompt: 'Enter the Xilinx/AMD part number',
    value: lastPart,
    placeHolder: 'e.g. xc7a35ticsg324-1L',
    validateInput: (v) => (v.trim() ? null : 'Part number cannot be empty'),
  });

  const trimmed = manual?.trim();
  if (trimmed) {
    await context.globalState.update(LAST_VIVADO_KEY, trimmed);
  }
  return trimmed ?? undefined;
}

export async function pickQuartusDevice(
  context: vscode.ExtensionContext,
  fallbackDefault?: string
): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const lastDevice =
    context.globalState.get<string>(LAST_QUARTUS_KEY) ?? fallbackDefault ?? '5CSEBA6U23I7';
  const customBoards =
    cfg.get<Array<{ label: string; device: string }>>('customBoards.quartus') ?? [];

  const items: QuartusPickItem[] = [];

  items.push({
    label: '$(edit) Enter custom device number…',
    alwaysShow: true,
  });

  if (customBoards.length > 0) {
    items.push({ label: 'My Boards', kind: vscode.QuickPickItemKind.Separator });
    for (const b of customBoards) {
      items.push({ label: b.label, description: b.device, device: b.device });
    }
  }

  const catalogDevices = new Set(QUARTUS_BOARDS.map((b) => b.device));
  const customDevices = new Set(customBoards.map((b) => b.device));
  if (lastDevice && !catalogDevices.has(lastDevice) && !customDevices.has(lastDevice)) {
    items.push({ label: 'Recently Used', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: lastDevice, description: 'custom — last used', device: lastDevice });
  }

  const groups = groupBy(QUARTUS_BOARDS, (b) => b.vendor);
  for (const [vendor, boards] of groups) {
    items.push({ label: vendor, kind: vscode.QuickPickItemKind.Separator });
    for (const b of boards) {
      items.push({ label: b.label, description: b.device, detail: b.family, device: b.device });
    }
  }

  const picked = await vscode.window.showQuickPick<QuartusPickItem>(items, {
    title: 'Select Target FPGA Board — Quartus',
    placeHolder: 'Search by board name, device number, or family…',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) {
    return undefined;
  }

  if (picked.device) {
    await context.globalState.update(LAST_QUARTUS_KEY, picked.device);
    return picked.device;
  }

  // "Enter custom device number…" chosen
  const manual = await vscode.window.showInputBox({
    title: 'Quartus — Custom Device Number',
    prompt: 'Enter the Intel/Altera device part number',
    value: lastDevice,
    placeHolder: 'e.g. 5CSEBA6U23I7',
    validateInput: (v) => (v.trim() ? null : 'Device number cannot be empty'),
  });

  const trimmed = manual?.trim();
  if (trimmed) {
    await context.globalState.update(LAST_QUARTUS_KEY, trimmed);
  }
  return trimmed ?? undefined;
}
