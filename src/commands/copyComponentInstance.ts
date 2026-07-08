import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import { extractVhdlInterface } from '../parser/VhdlParser';
import { extractVerilogInterface } from '../parser/VerilogParser';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

const COPIED_CONTEXT_KEY = 'ipcraft.instanceJustCopied';
const FEEDBACK_DURATION_MS = 2000;

export async function copyComponentInstanceCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    return;
  }

  const fsPath = targetUri.fsPath;
  const ext = fsPath.split('.').pop()?.toLowerCase() ?? '';
  const isVhdl = ext === 'vhd' || ext === 'vhdl';
  const isSv = ext === 'sv' || ext === 'v';

  if (!isVhdl && !isSv) {
    void vscode.window.showErrorMessage(
      'Copy Component Instance: not a VHDL or SystemVerilog file.'
    );
    return;
  }

  try {
    const content = await fs.readFile(fsPath, 'utf8');
    const snippet = isVhdl ? buildVhdlInstance(content) : buildSvInstance(content);

    await vscode.env.clipboard.writeText(snippet);

    // Swap the toolbar button to the "Copied!" variant for 2 s, then restore.
    await vscode.commands.executeCommand('setContext', COPIED_CONTEXT_KEY, true);
    setTimeout(() => {
      void vscode.commands.executeCommand('setContext', COPIED_CONTEXT_KEY, false);
    }, FEEDBACK_DURATION_MS);
  } catch (error) {
    void handleErrorWithUserNotification(
      error,
      'copyComponentInstance',
      `Copy Component Instance failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// No-op handler shown while the "Copied!" button is visible.
export function copyComponentInstanceDoneCommand(): void {
  // Intentionally empty — the button exists only for visual feedback.
}

// ---------------------------------------------------------------------------
// VHDL instantiation builder
// ---------------------------------------------------------------------------

function buildVhdlInstance(content: string): string {
  const { entityName, parameters, ports } = extractVhdlInterface(content);
  const name = entityName ?? 'unknown';
  const lines: string[] = [];

  lines.push(`u_${name} : entity work.${name}`);

  if (parameters.length > 0) {
    const col = Math.max(...parameters.map((p) => p.name.length));
    lines.push('  generic map (');
    parameters.forEach((p, i) => {
      const comma = i < parameters.length - 1 ? ',' : '';
      lines.push(`    ${p.name.padEnd(col)} => ${p.name}${comma}`);
    });
    lines.push('  )');
  }

  const col = ports.length > 0 ? Math.max(...ports.map((p) => p.name.length)) : 0;
  lines.push('  port map (');
  ports.forEach((p, i) => {
    const comma = i < ports.length - 1 ? ',' : '';
    lines.push(`    ${p.name.padEnd(col)} => ${p.name}${comma}`);
  });
  lines.push('  );');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// SystemVerilog instantiation builder
// ---------------------------------------------------------------------------

function buildSvInstance(content: string): string {
  const { moduleName, parameters, ports } = extractVerilogInterface(content);
  const name = moduleName ?? 'unknown';
  const lines: string[] = [];

  if (parameters.length > 0) {
    const col = Math.max(...parameters.map((p) => p.name.length));
    lines.push(`${name} #(`);
    parameters.forEach((p, i) => {
      const comma = i < parameters.length - 1 ? ',' : '';
      lines.push(`  .${p.name.padEnd(col)} (${p.name})${comma}`);
    });
    lines.push(`) u_${name} (`);
  } else {
    lines.push(`${name} u_${name} (`);
  }

  const col = ports.length > 0 ? Math.max(...ports.map((p) => p.name.length)) : 0;
  ports.forEach((p, i) => {
    const comma = i < ports.length - 1 ? ',' : '';
    lines.push(`  .${p.name.padEnd(col)} (${p.name})${comma}`);
  });
  lines.push(');');

  return lines.join('\n');
}
