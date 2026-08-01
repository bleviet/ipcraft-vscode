import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  readSidecar,
  writeSidecar,
  detectVivadoProjectVersion,
  detectQuartusProjectVersion,
} from '../../../../services/toolchains/toolchainVersionDetector';
import * as toolchainVersions from '../../../../utils/toolchainVersions';

describe('toolchainVersionDetector', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-detector-test-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  describe('sidecar', () => {
    it('round-trips through write/read', async () => {
      const data = { vendor: 'vivado' as const, version: '2024.2', sourcePath: '/x/foo.xpr' };
      await writeSidecar(dir, data);
      expect(await readSidecar(dir)).toEqual(data);
    });

    it('resolves without throwing when the target directory does not exist', async () => {
      // createProject() calls writeSidecar as a best-effort hint; a rejected
      // write would break the "TCL written, run manually" fallback path.
      const missing = path.join(dir, 'no', 'such', 'dir');
      await expect(
        writeSidecar(missing, { vendor: 'vivado', version: '2024.2', sourcePath: '/x' })
      ).resolves.toBeUndefined();
      expect(await readSidecar(missing)).toBeUndefined();
    });

    it('returns undefined when the sidecar is missing', async () => {
      expect(await readSidecar(dir)).toBeUndefined();
    });

    it('returns undefined when the sidecar has invalid JSON', async () => {
      await fs.writeFile(path.join(dir, '.ipcraft-toolchain.json'), '{not json', 'utf8');
      expect(await readSidecar(dir)).toBeUndefined();
    });

    it('returns undefined when the sidecar has the wrong shape', async () => {
      await fs.writeFile(
        path.join(dir, '.ipcraft-toolchain.json'),
        JSON.stringify({ foo: 'bar' }),
        'utf8'
      );
      expect(await readSidecar(dir)).toBeUndefined();
    });
  });

  describe('detectQuartusProjectVersion', () => {
    it('prefers the sidecar over the project file', async () => {
      await writeSidecar(dir, { vendor: 'quartus', version: '99.9', sourcePath: 'x' });
      const qpfPath = path.join(dir, 'foo.qpf');
      await fs.writeFile(qpfPath, 'QUARTUS_VERSION = "23.1"\n', 'utf8');
      expect(await detectQuartusProjectVersion(qpfPath)).toEqual({
        confidence: 'exact',
        candidates: ['99.9'],
        source: 'sidecar',
      });
    });

    it('reads QUARTUS_VERSION from the .qpf when no sidecar exists', async () => {
      const qpfPath = path.join(dir, 'foo.qpf');
      await fs.writeFile(qpfPath, 'QUARTUS_VERSION = "23.1"\n', 'utf8');
      expect(await detectQuartusProjectVersion(qpfPath)).toEqual({
        confidence: 'exact',
        candidates: ['23.1'],
        source: 'project-file',
      });
    });

    it('returns none when no project file exists', async () => {
      expect(await detectQuartusProjectVersion(path.join(dir, 'missing.qpf'))).toEqual({
        confidence: 'none',
        candidates: [],
        source: 'none',
      });
    });
  });

  describe('detectVivadoProjectVersion', () => {
    it('reports exact when the format version maps to a single release', async () => {
      jest.spyOn(toolchainVersions, 'candidateVivadoReleases').mockReturnValue(['2024.2']);
      const xprPath = path.join(dir, 'foo.xpr');
      await fs.writeFile(xprPath, '<Project Version="7" Minor="0">', 'utf8');
      expect(await detectVivadoProjectVersion(xprPath)).toEqual({
        confidence: 'exact',
        candidates: ['2024.2'],
        source: 'project-file',
      });
    });

    it('reports ambiguous when the format version maps to multiple releases', async () => {
      jest
        .spyOn(toolchainVersions, 'candidateVivadoReleases')
        .mockReturnValue(['2024.1', '2024.2']);
      const xprPath = path.join(dir, 'foo.xpr');
      await fs.writeFile(xprPath, '<Project Version="7" Minor="0">', 'utf8');
      expect(await detectVivadoProjectVersion(xprPath)).toEqual({
        confidence: 'ambiguous',
        candidates: ['2024.1', '2024.2'],
        source: 'project-file',
      });
    });

    it('reports none when the format version is unlisted', async () => {
      jest.spyOn(toolchainVersions, 'candidateVivadoReleases').mockReturnValue([]);
      const xprPath = path.join(dir, 'foo.xpr');
      await fs.writeFile(xprPath, '<Project Version="999" Minor="0">', 'utf8');
      expect(await detectVivadoProjectVersion(xprPath)).toEqual({
        confidence: 'none',
        candidates: [],
        source: 'none',
      });
    });
  });
});
