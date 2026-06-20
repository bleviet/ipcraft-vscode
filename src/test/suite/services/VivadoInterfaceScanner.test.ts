import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const FAKE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-config-test-'));
jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => FAKE_CONFIG_DIR,
}));

import {
  VivadoInterfaceScanner,
  getVivadoInterfaceCacheDir,
} from '../../../services/VivadoInterfaceScanner';

const SPIRIT_HEADER =
  'xmlns:xilinx="http://www.xilinx.com" xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

const FIFO_WRITE_BUSDEF = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:busDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>fifo_write</spirit:name>
  <spirit:version>1.0</spirit:version>
</spirit:busDefinition>`;

const FIFO_WRITE_RTL = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:abstractionDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>fifo_write_rtl</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="fifo_write" spirit:version="1.0"/>
  <spirit:ports>
    <spirit:port>
      <spirit:logicalName>WR_EN</spirit:logicalName>
      <spirit:wire>
        <spirit:onMaster>
          <spirit:presence>required</spirit:presence>
          <spirit:width>1</spirit:width>
          <spirit:direction>out</spirit:direction>
        </spirit:onMaster>
      </spirit:wire>
    </spirit:port>
  </spirit:ports>
</spirit:abstractionDefinition>`;

function makeFakeVivadoInstall(): { installDir: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-vivado-install-test-'));
  const versionDir = path.join(root, '2099.1');
  const binDir = path.join(versionDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, process.platform === 'win32' ? 'vivado.bat' : 'vivado'), '');

  // fifo_v1_0/ bundles two interfaces, mirroring the real catalog layout.
  const fifoDir = path.join(versionDir, 'data', 'ip', 'interfaces', 'fifo_v1_0');
  fs.mkdirSync(fifoDir, { recursive: true });
  fs.writeFileSync(path.join(fifoDir, 'fifo_write.xml'), FIFO_WRITE_BUSDEF);
  fs.writeFileSync(path.join(fifoDir, 'fifo_write_rtl.xml'), FIFO_WRITE_RTL);
  // A non-XML file in the same directory must be ignored, not crash the scan.
  fs.writeFileSync(path.join(fifoDir, 'README.txt'), 'not xml');

  return {
    installDir: versionDir,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

describe('VivadoInterfaceScanner', () => {
  afterEach(() => {
    fs.rmSync(getVivadoInterfaceCacheDir(), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(FAKE_CONFIG_DIR, { recursive: true, force: true });
  });

  it('throws a clear error when vivado.installDir is not configured', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
    const scanner = new VivadoInterfaceScanner();
    await expect(scanner.scan()).rejects.toThrow(/not configured/);
  });

  it('throws a clear error when the configured directory has no Vivado install', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: () => '/no/such/path/at/all',
    });
    const scanner = new VivadoInterfaceScanner();
    await expect(scanner.scan()).rejects.toThrow(/Could not find a Vivado installation/);
  });

  it('scans a fake install and writes one YAML file per resolved interface', async () => {
    const { installDir, cleanup } = makeFakeVivadoInstall();
    try {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: () => installDir,
      });
      const scanner = new VivadoInterfaceScanner();
      const result = await scanner.scan();

      expect(result.count).toBe(1);
      expect(result.version).toBe('2099.1');

      const files = fs.readdirSync(result.cacheDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe('xilinx_com_interface_fifo_write_1_0.yml');

      const content = fs.readFileSync(path.join(result.cacheDir, files[0]), 'utf8');
      expect(content).toContain('vendor: xilinx.com');
      expect(content).toContain('name: fifo_write');
      expect(content).toContain('name: WR_EN');
    } finally {
      cleanup();
    }
  });

  it('clears stale entries from a previous scan rather than accumulating them', async () => {
    const { installDir, cleanup } = makeFakeVivadoInstall();
    try {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: () => installDir,
      });
      const scanner = new VivadoInterfaceScanner();
      await scanner.scan();

      // Seed a stale file from a hypothetical earlier scan / different Vivado version.
      const cacheDir = getVivadoInterfaceCacheDir();
      fs.writeFileSync(path.join(cacheDir, 'stale_leftover.yml'), 'STALE: {}');

      await scanner.scan();

      const files = fs.readdirSync(cacheDir);
      expect(files).not.toContain('stale_leftover.yml');
      expect(files).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  it('resolves a Vivado family directory (not just the version-specific dir)', async () => {
    const { installDir, cleanup } = makeFakeVivadoInstall();
    const familyDir = path.dirname(installDir);
    try {
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: () => familyDir,
      });
      const scanner = new VivadoInterfaceScanner();
      const result = await scanner.scan();
      expect(result.count).toBe(1);
    } finally {
      cleanup();
    }
  });
});
