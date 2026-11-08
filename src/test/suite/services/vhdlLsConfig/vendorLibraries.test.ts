/** @jest-environment node */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveVendorInstalls,
  vendorFilesFor,
} from '../../../../services/vhdlLsConfig/vendorLibraries';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vendor-libs-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function touch(...parts: string[]): string {
  const file = path.join(tmp, ...parts);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  return file;
}

const noSettings = {
  vivadoInstallDirs: [],
  quartusInstallDirs: [],
};

describe('resolveVendorInstalls', () => {
  it('picks the highest Vivado version, or the pinned one', () => {
    touch('v', '2023.2', 'bin', 'vivado');
    touch('v', '2024.2', 'bin', 'vivado');
    const dirs = [path.join(tmp, 'v', '2023.2'), path.join(tmp, 'v', '2024.2')];
    const latest = resolveVendorInstalls({ ...noSettings, vivadoInstallDirs: dirs });
    expect(latest.vivado).toMatchObject({
      version: '2024.2',
      setting: 'ipcraft.vivado.installDirs',
    });
    const pinned = resolveVendorInstalls({
      ...noSettings,
      vivadoInstallDirs: dirs,
      vivadoPinnedVersion: '2023.2',
    });
    expect(pinned.vivado?.version).toBe('2023.2');
  });

  it('falls back to the deprecated installDir setting', () => {
    touch('v', '2024.2', 'bin', 'vivado');
    const result = resolveVendorInstalls({
      ...noSettings,
      vivadoInstallDir: path.join(tmp, 'v'),
      quartusInstallDir: path.join(tmp, 'q', '23.1'),
    });
    expect(result.vivado).toMatchObject({
      version: '2024.2',
      setting: 'ipcraft.vivado.installDir',
    });
    expect(result.quartus).toBeUndefined();
  });

  it('uses existing Quartus directories as-is', () => {
    fs.mkdirSync(path.join(tmp, 'q', '22.1'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'q', '23.1'), { recursive: true });
    const result = resolveVendorInstalls({
      ...noSettings,
      quartusInstallDirs: [
        path.join(tmp, 'q', '22.1'),
        path.join(tmp, 'q', '23.1'),
        path.join(tmp, 'gone'),
      ],
    });
    expect(result.quartus?.version).toBe('23.1');
  });

  it('returns nothing when no install exists', () => {
    expect(resolveVendorInstalls(noSettings)).toEqual({ vivado: undefined, quartus: undefined });
  });
});

describe('vendorFilesFor', () => {
  it('returns only the vendor files that exist', () => {
    const file = touch('q', '23.1', 'quartus', 'eda', 'sim_lib', 'altera_mf.vhd');
    const installs = {
      quartus: {
        dir: path.join(tmp, 'q', '23.1'),
        setting: 'ipcraft.quartus.installDirs',
        version: '23.1',
      },
    };
    expect(vendorFilesFor('altera_mf', installs)).toEqual({
      files: [file],
      setting: 'ipcraft.quartus.installDirs',
      version: '23.1',
    });
    expect(vendorFilesFor('lpm', installs)).toBeUndefined();
    expect(vendorFilesFor('unisim', installs)).toBeUndefined();
    expect(vendorFilesFor('osvvm', installs)).toBeUndefined();
  });

  describe('version labels', () => {
    it('uses the major.minor in the directory name so pins match', () => {
      fs.mkdirSync(path.join(tmp, 'quartus_22.1'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'quartus_23.1std'), { recursive: true });
      const dirs = [path.join(tmp, 'quartus_22.1'), path.join(tmp, 'quartus_23.1std')];
      const pinned = resolveVendorInstalls({
        vivadoInstallDirs: [],
        quartusInstallDirs: dirs,
        quartusPinnedVersion: '22.1',
      });
      expect(pinned.quartus).toMatchObject({ version: '22.1', dir: dirs[0] });
      expect(
        resolveVendorInstalls({ vivadoInstallDirs: [], quartusInstallDirs: dirs }).quartus?.version
      ).toBe('23.1');
    });
  });
});
