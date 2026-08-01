import { execFileSync } from 'child_process';

/**
 * Detects the Quartus version at a specific resolved `quartus_sh` path, by
 * running `quartus_sh --version`. Returns undefined when the probe fails or
 * the output doesn't contain a "Version N.N" line — callers should fall
 * back to a folder-name-derived version label in that case.
 */
export function detectQuartusVersionAt(exe: string): string | undefined {
  try {
    const output = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 });
    const match = output.match(/Version\s+(\d+\.\d+)/i);
    return match?.[1];
  } catch {
    return undefined;
  }
}
