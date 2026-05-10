import { execSync } from 'child_process';

/**
 * Detects the installed Vivado version by running `vivado -version`.
 * Returns the version string (e.g. '2024.2'). Defaults to '2024.2' if not found.
 */
export function detectVivadoVersion(): string {
  try {
    const output = execSync('vivado -version', { encoding: 'utf8', timeout: 2000 });
    const match = output.match(/vivado v(\d+\.\d+)/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Vivado not installed or not in PATH
  }
  return '2024.2';
}
