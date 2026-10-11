import * as fs from 'fs/promises';
import * as path from 'path';
import { zipSync } from 'fflate';
import type { IpPackagePlan } from './planIpPackage';

/** Writes the package into `outDir`, which must not exist or must be empty. */
export async function writePackageToDirectory(plan: IpPackagePlan, outDir: string): Promise<void> {
  const existing = await fs.readdir(outDir).catch(() => undefined);
  if (existing && existing.length > 0) {
    throw new Error(`Output directory is not empty: ${outDir}`);
  }
  for (const [rel, content] of plan.entries) {
    const target = path.join(outDir, ...rel.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
}

/** Writes the package as a .zip whose single top folder is the archive's basename. */
export async function writePackageToZip(plan: IpPackagePlan, zipPath: string): Promise<void> {
  const top = path.basename(zipPath).replace(/\.zip$/i, '');
  const files: Record<string, Uint8Array> = {};
  for (const [rel, content] of plan.entries) {
    files[`${top}/${rel}`] = content;
  }
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  await fs.writeFile(zipPath, zipSync(files));
}
