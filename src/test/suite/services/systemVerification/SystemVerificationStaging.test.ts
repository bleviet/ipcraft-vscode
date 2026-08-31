import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StagingPanel } from '../../../../providers/StagingPanel';
import { stageSystemVerificationFiles } from '../../../../services/systemVerification/SystemVerificationStaging';

describe('stageSystemVerificationFiles', () => {
  let verificationDir: string;

  beforeEach(() => {
    verificationDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-system-verification-'));
  });

  afterEach(() => {
    fs.rmSync(verificationDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('opens the existing panel before writing a new file', async () => {
    jest.spyOn(StagingPanel, 'show').mockResolvedValue({
      confirmed: false,
      mergedPaths: [],
      overwritePaths: [],
    });

    await stageSystemVerificationFiles({ Makefile: 'run:\n' }, verificationDir);

    expect(StagingPanel.show).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          relativePath: 'Makefile',
          status: 'new',
          diskPath: path.join(verificationDir, 'Makefile'),
        }),
      ],
      []
    );
    expect(fs.existsSync(path.join(verificationDir, 'Makefile'))).toBe(false);
  });

  it('writes only accepted new and selected modified files', async () => {
    fs.writeFileSync(path.join(verificationDir, 'Makefile'), 'old\n', 'utf8');
    fs.writeFileSync(path.join(verificationDir, 'unchanged.txt'), 'same\n', 'utf8');
    jest.spyOn(StagingPanel, 'show').mockResolvedValue({
      confirmed: true,
      mergedPaths: [],
      overwritePaths: ['Makefile'],
    });

    const result = await stageSystemVerificationFiles(
      { Makefile: 'run:\n', 'new.txt': 'new\n', 'unchanged.txt': 'same\n' },
      verificationDir
    );

    expect(result).toEqual({ accepted: true, writtenPaths: ['Makefile', 'new.txt'] });
    expect(fs.readFileSync(path.join(verificationDir, 'Makefile'), 'utf8')).toBe('run:\n');
    expect(fs.readFileSync(path.join(verificationDir, 'new.txt'), 'utf8')).toBe('new\n');
    expect(fs.readFileSync(path.join(verificationDir, 'unchanged.txt'), 'utf8')).toBe('same\n');
  });

  it('writes nothing when staging is cancelled', async () => {
    fs.writeFileSync(path.join(verificationDir, 'Makefile'), 'old\n', 'utf8');
    jest.spyOn(StagingPanel, 'show').mockResolvedValue({
      confirmed: false,
      mergedPaths: [],
      overwritePaths: ['Makefile'],
    });

    await expect(
      stageSystemVerificationFiles({ Makefile: 'run:\n', 'new.txt': 'new\n' }, verificationDir)
    ).resolves.toEqual({ accepted: false, writtenPaths: [] });
    expect(fs.readFileSync(path.join(verificationDir, 'Makefile'), 'utf8')).toBe('old\n');
    expect(fs.existsSync(path.join(verificationDir, 'new.txt'))).toBe(false);
  });

  it('keeps merge-selected paths out of the bulk write', async () => {
    fs.writeFileSync(path.join(verificationDir, 'Makefile'), 'old\n', 'utf8');
    jest.spyOn(StagingPanel, 'show').mockResolvedValue({
      confirmed: true,
      mergedPaths: ['Makefile'],
      overwritePaths: ['Makefile'],
    });

    await expect(
      stageSystemVerificationFiles({ Makefile: 'run:\n' }, verificationDir)
    ).resolves.toEqual({ accepted: true, writtenPaths: [] });
    expect(fs.readFileSync(path.join(verificationDir, 'Makefile'), 'utf8')).toBe('old\n');
  });

  it('rejects a generated path that escapes the verification directory', async () => {
    const outsidePath = path.join(path.dirname(verificationDir), 'escaped.txt');
    jest.spyOn(StagingPanel, 'show');

    await expect(
      stageSystemVerificationFiles({ '../escaped.txt': 'unsafe\n' }, verificationDir)
    ).rejects.toThrow(/must remain within the verification directory/);
    expect(StagingPanel.show).not.toHaveBeenCalled();
    expect(fs.existsSync(outsidePath)).toBe(false);
  });

  it('rejects a generated path with a symlinked directory component', async () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ipcraft-system-verification-outside-')
    );
    const outsidePath = path.join(outsideDir, 'Makefile');
    fs.symlinkSync(outsideDir, path.join(verificationDir, 'generated'), 'dir');
    jest.spyOn(StagingPanel, 'show');

    try {
      await expect(
        stageSystemVerificationFiles({ 'generated/Makefile': 'unsafe\n' }, verificationDir)
      ).rejects.toThrow(/symbolic link/i);
      expect(StagingPanel.show).not.toHaveBeenCalled();
      expect(fs.existsSync(outsidePath)).toBe(false);
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('rejects a generated path whose target is a symlink', async () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ipcraft-system-verification-outside-')
    );
    const outsidePath = path.join(outsideDir, 'Makefile');
    fs.writeFileSync(outsidePath, 'protected\n', 'utf8');
    fs.symlinkSync(outsidePath, path.join(verificationDir, 'Makefile'), 'file');
    jest.spyOn(StagingPanel, 'show');

    try {
      await expect(
        stageSystemVerificationFiles({ Makefile: 'unsafe\n' }, verificationDir)
      ).rejects.toThrow(/symbolic link/i);
      expect(StagingPanel.show).not.toHaveBeenCalled();
      expect(fs.readFileSync(outsidePath, 'utf8')).toBe('protected\n');
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('fails before staging when a generated target is a directory', async () => {
    fs.mkdirSync(path.join(verificationDir, 'Makefile'));
    jest.spyOn(StagingPanel, 'show');

    await expect(
      stageSystemVerificationFiles({ Makefile: 'unsafe\n' }, verificationDir)
    ).rejects.toMatchObject({ code: 'EISDIR' });
    expect(StagingPanel.show).not.toHaveBeenCalled();
  });

  it('fails before staging when an existing generated target cannot be read', async () => {
    const unreadablePath = path.join(verificationDir, 'Makefile');
    fs.writeFileSync(unreadablePath, 'protected\n', 'utf8');
    fs.chmodSync(unreadablePath, 0o000);
    jest.spyOn(StagingPanel, 'show');

    try {
      await expect(
        stageSystemVerificationFiles({ Makefile: 'unsafe\n' }, verificationDir)
      ).rejects.toMatchObject({ code: 'EACCES' });
      expect(StagingPanel.show).not.toHaveBeenCalled();
    } finally {
      fs.chmodSync(unreadablePath, 0o600);
    }
  });

  it('writes an accepted file when the platform has no final-leaf no-follow flag', async () => {
    jest.resetModules();
    jest.doMock('fs', () => {
      const actual = jest.requireActual<typeof import('fs')>('fs');
      return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: undefined } };
    });
    jest.doMock('../../../../providers/StagingPanel', () => ({
      StagingPanel: {
        show: jest.fn().mockResolvedValue({
          confirmed: true,
          mergedPaths: [],
          overwritePaths: [],
        }),
      },
    }));

    try {
      const { stageSystemVerificationFiles: stageInUnsupportedEnvironment } =
        await import('../../../../services/systemVerification/SystemVerificationStaging');

      await expect(
        stageInUnsupportedEnvironment({ Makefile: 'run:\n' }, verificationDir)
      ).resolves.toEqual({ accepted: true, writtenPaths: ['Makefile'] });
      expect(fs.readFileSync(path.join(verificationDir, 'Makefile'), 'utf8')).toBe('run:\n');
    } finally {
      jest.dontMock('fs');
      jest.dontMock('../../../../providers/StagingPanel');
      jest.resetModules();
    }
  });
});
