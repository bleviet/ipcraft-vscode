import * as fs from 'fs/promises';

/**
 * Check if a file or directory exists at the given path.
 */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
