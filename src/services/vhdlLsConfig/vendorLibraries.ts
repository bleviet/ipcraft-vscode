/**
 * Vendor simulation libraries (UNISIM, Altera MF, ...) that a vhdl_ls.toml can point at.
 * Only checks the file system; never launches a vendor tool.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveVivadoInstallDir } from '../../utils/vivadoResolver';
import { compareVersions } from '../../utils/toolchainVersions';

export interface VendorInstall {
  /** The version directory. */
  dir: string;
  /** Settings key the install came from. */
  setting: string;
  version: string;
}

export interface VendorInstalls {
  vivado?: VendorInstall;
  quartus?: VendorInstall;
}

export interface VendorSettings {
  vivadoInstallDirs: string[];
  vivadoInstallDir?: string;
  vivadoPinnedVersion?: string;
  quartusInstallDirs: string[];
  quartusInstallDir?: string;
  quartusPinnedVersion?: string;
}

interface VendorLibrary {
  vendor: keyof VendorInstalls;
  /** Relative to the version directory. */
  files: string[];
}

const SIM_LIB = 'quartus/eda/sim_lib';

const VENDOR_LIBRARIES: Record<string, VendorLibrary> = {
  unisim: { vendor: 'vivado', files: ['data/vhdl/src/unisims/unisim_VCOMP.vhd'] },
  unimacro: { vendor: 'vivado', files: ['data/vhdl/src/unimacro/unimacro_VCOMP.vhd'] },
  xpm: { vendor: 'vivado', files: ['data/ip/xpm/xpm_VCOMP.vhd'] },
  altera_mf: {
    vendor: 'quartus',
    files: [`${SIM_LIB}/altera_mf_components.vhd`, `${SIM_LIB}/altera_mf.vhd`],
  },
  lpm: { vendor: 'quartus', files: [`${SIM_LIB}/220pack.vhd`, `${SIM_LIB}/220model.vhd`] },
  altera: {
    vendor: 'quartus',
    files: [`${SIM_LIB}/altera_primitives_components.vhd`, `${SIM_LIB}/altera_primitives.vhd`],
  },
  altera_lnsim: { vendor: 'quartus', files: [`${SIM_LIB}/altera_lnsim_components.vhd`] },
};

export interface VendorFiles {
  files: string[];
  setting: string;
  version: string;
}

/** Existing vendor files for a library name, or undefined when none are installed. */
export function vendorFilesFor(name: string, installs: VendorInstalls): VendorFiles | undefined {
  const library = VENDOR_LIBRARIES[name];
  const install = library && installs[library.vendor];
  if (!library || !install) {
    return undefined;
  }
  const files = library.files
    .map((file) => path.join(install.dir, ...file.split('/')))
    .filter((file) => fs.existsSync(file));
  return files.length > 0
    ? { files, setting: install.setting, version: install.version }
    : undefined;
}

/** The first `major.minor` in the directory name (`quartus_23.1` -> `23.1`), else the name. */
function versionLabel(dir: string): string {
  const name = path.basename(dir);
  return /\d+\.\d+/.exec(name)?.[0] ?? name;
}

function pickInstall(
  dirs: string[],
  pinnedVersion: string | undefined,
  setting: string
): VendorInstall | undefined {
  const installs = dirs.map((dir) => ({ dir, setting, version: versionLabel(dir) }));
  return (
    installs.find((i) => pinnedVersion && i.version === pinnedVersion) ??
    installs.sort((a, b) => compareVersions(b.version, a.version))[0]
  );
}

export function resolveVendorInstalls(settings: VendorSettings): VendorInstalls {
  const resolveVivado = (dirs: string[]): string[] =>
    dirs.flatMap((dir) => resolveVivadoInstallDir(dir) ?? []);
  const existing = (dirs: string[]): string[] => dirs.filter((dir) => fs.existsSync(dir));
  const single = (dir: string | undefined): string[] => (dir ? [dir] : []);

  const vivadoDirs = resolveVivado(settings.vivadoInstallDirs);
  const quartusDirs = existing(settings.quartusInstallDirs);
  return {
    vivado:
      vivadoDirs.length > 0
        ? pickInstall(vivadoDirs, settings.vivadoPinnedVersion, 'ipcraft.vivado.installDirs')
        : pickInstall(
            resolveVivado(single(settings.vivadoInstallDir)),
            settings.vivadoPinnedVersion,
            'ipcraft.vivado.installDir'
          ),
    quartus:
      quartusDirs.length > 0
        ? pickInstall(quartusDirs, settings.quartusPinnedVersion, 'ipcraft.quartus.installDirs')
        : pickInstall(
            existing(single(settings.quartusInstallDir)),
            settings.quartusPinnedVersion,
            'ipcraft.quartus.installDir'
          ),
  };
}
