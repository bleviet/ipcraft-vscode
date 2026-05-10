import * as os from 'os';
import * as path from 'path';

/**
 * Returns the OS-specific application data directory for IPCraft.
 * - Linux: ~/.config/ipcraft (or $XDG_CONFIG_HOME/ipcraft)
 * - Windows: %APPDATA%\ipcraft
 * - macOS: ~/Library/Application Support/ipcraft
 */
export function getIpcraftConfigDir(): string {
  const platform = os.platform();
  const homedir = os.homedir();

  if (platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(homedir, 'AppData', 'Roaming'), 'ipcraft');
  }

  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'ipcraft');
  }

  // Linux and others
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? path.join(homedir, '.config');
  return path.join(xdgConfigHome, 'ipcraft');
}
