import * as vscode from 'vscode';
import { listAll } from './toolchains/registry';

/**
 * Probes all registered synthesis toolchains and writes VS Code context keys so
 * menus and enablement clauses stay up to date. Each toolchain's declared
 * `subTools` are also probed so companion executables (e.g. `qsys-edit`) get
 * their own context keys without any special-casing here.
 *
 * The probes (`isAvailable` / `isSubToolAvailable`) fall through to synchronous
 * `spawnSync('which', …)` calls. To keep them off the extension-host activation
 * critical path, the whole sweep is deferred via a microtask + `setImmediate`,
 * so this function returns instantly and the context keys settle a tick later
 * (menus re-evaluate automatically). Fire-and-forget; safe to call repeatedly.
 *
 * NOTE: deferral removes the probes from the activation path, but `spawnSync`
 * still blocks the event loop when it eventually fires. The durable fix is to
 * convert `isAvailable` to async `spawn`/`which` and `await` it here.
 *
 * Call on extension activation and whenever any `ipcraft.*` settings change.
 */
export function detectAndSetToolContext(): void {
  void Promise.resolve().then(() =>
    setImmediate(() => {
      const cfg = vscode.workspace.getConfiguration('ipcraft');

      for (const toolchain of listAll()) {
        const available = toolchain.isAvailable(cfg);
        void vscode.commands.executeCommand('setContext', toolchain.contextKey, available);

        for (const st of toolchain.subTools) {
          const stAvailable = toolchain.isSubToolAvailable(st.name, cfg);
          void vscode.commands.executeCommand('setContext', st.contextKey, stAvailable);
        }
      }
    })
  );
}
