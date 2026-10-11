import * as fs from 'fs/promises';
import * as path from 'path';
import { planIpPackage, writePackageToDirectory, writePackageToZip } from '../services/packaging';

export interface CliPackageArgs {
  ipYamlPath: string;
  /** Package directory, or the .zip file path with `zip`. */
  out: string;
  zip: boolean;
}

export interface CliPackageResult {
  success: boolean;
  error?: string;
  warnings: string[];
  fileCount: number;
  outputPath: string;
}

/** Core logic behind `ipcraft package`: bundles an .ip.yml and everything it references. */
export async function runCliPackage(args: CliPackageArgs): Promise<CliPackageResult> {
  const outputPath = path.resolve(args.out);
  const result: CliPackageResult = { success: false, warnings: [], fileCount: 0, outputPath };
  try {
    if (args.zip && (await fs.stat(outputPath).catch(() => undefined))) {
      throw new Error(`Output file already exists: ${outputPath}`);
    }
    const plan = await planIpPackage(path.resolve(args.ipYamlPath));
    result.warnings = plan.warnings;
    result.fileCount = plan.entries.size;
    await (args.zip
      ? writePackageToZip(plan, outputPath)
      : writePackageToDirectory(plan, outputPath));
    result.success = true;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
