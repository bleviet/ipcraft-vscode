/**
 * Where IPCraft's Build commands write their output next to an IP core's `.ip.yml`. Pure: the
 * toolchains run builds there, and the resource view reads the reports from the same places.
 */

import * as path from 'path';

export const VIVADO_OUTPUT_SUBDIR = 'xilinx';
export const QUARTUS_OUTPUT_SUBDIR = 'altera';

/** Vivado build folder of an `ooc` or `xpr` run: `<ipDir>/xilinx/build/<mode>`. */
export const vivadoBuildDir = (ipDir: string, mode: 'ooc' | 'xpr'): string =>
  path.join(ipDir, VIVADO_OUTPUT_SUBDIR, 'build', mode);

/** Quartus build folder: `<ipDir>/altera/build`. */
export const quartusBuildDir = (ipDir: string): string =>
  path.join(ipDir, QUARTUS_OUTPUT_SUBDIR, 'build');

/** Where the Quartus compile leaves its reports (`PROJECT_OUTPUT_DIRECTORY`). */
export const quartusOutputFilesDir = (buildDir: string): string =>
  path.join(buildDir, 'output_files');

/** The name the builds use for an IP core: its `vlnv.name`, lower case; none when it has none. */
export function ipCoreBuildName(data: unknown): string | undefined {
  const name = (data as { vlnv?: { name?: unknown } } | null | undefined)?.vlnv?.name;
  return String(name ?? '').toLowerCase() || undefined;
}
