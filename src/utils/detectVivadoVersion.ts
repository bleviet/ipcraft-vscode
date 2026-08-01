import { execSync, execFileSync } from 'child_process';

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

/**
 * Detects the Vivado version at a specific resolved launcher, by running
 * `<exe> [...prefixArgs] -version`. Returns undefined when the probe fails
 * or the output doesn't match `vivado vYYYY.N` — callers should fall back
 * to a folder-name-derived version label in that case.
 */
export function detectVivadoVersionAt(exe: string, prefixArgs: string[] = []): string | undefined {
  try {
    const output = execFileSync(exe, [...prefixArgs, '-version'], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const match = output.match(/vivado v(\d+\.\d+)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}
