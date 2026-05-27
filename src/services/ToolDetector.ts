import * as vscode from 'vscode';
import { listAll } from './toolchains/registry';

/**
 * Probes all registered synthesis toolchains and writes VS Code context keys so
 * menus and enablement clauses stay up to date. Each toolchain's declared
 * `subTools` are also probed so companion executables (e.g. `qsys-edit`) get
 * their own context keys without any special-casing here.
 *
 * Call on extension activation and whenever any `ipcraft.*` settings change.
 */
export function detectAndSetToolContext(): void {
  const cfg = vscode.workspace.getConfiguration('ipcraft');

  for (const toolchain of listAll()) {
    const available = toolchain.isAvailable(cfg);
    void vscode.commands.executeCommand('setContext', toolchain.contextKey, available);

    for (const st of toolchain.subTools) {
      const stAvailable = toolchain.isSubToolAvailable(st.name, cfg);
      void vscode.commands.executeCommand('setContext', st.contextKey, stAvailable);
    }
  }
}
