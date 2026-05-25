import * as fs from 'fs/promises';

/** Returns true when the path is readable, false on any access error. */
export async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
