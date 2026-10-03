import {
  CLI_SHIM_MARKER,
  addPathEntry,
  cliScriptName,
  externalShimDir,
  isDirOnPath,
  removePathEntry,
  renderCliLauncher,
  renderCliShim,
} from '../../../services/CliShim';

describe('CliShim', () => {
  describe.each<NodeJS.Platform>(['linux', 'darwin'])('POSIX (%s)', (platform) => {
    it('names the script ipcraft', () => {
      expect(cliScriptName(platform)).toBe('ipcraft');
    });

    it('renders a launcher with quoted paths', () => {
      const out = renderCliLauncher(platform, '/opt/my app/code', '/ext dir/dist/cli.js', false);
      expect(out.startsWith('#!/bin/sh\n')).toBe(true);
      expect(out).toContain(CLI_SHIM_MARKER);
      expect(out).toContain(
        `ELECTRON_RUN_AS_NODE=1 exec '/opt/my app/code' '/ext dir/dist/cli.js' "$@"`
      );
      expect(out).not.toContain('\r');
    });

    it('adds the Electron switch only for Electron', () => {
      const on = renderCliLauncher(platform, '/e', '/c.js', true);
      expect(on).toContain(`exec '/e' --ms-enable-electron-run-as-node '/c.js' "$@"`);
      expect(renderCliLauncher(platform, '/e', '/c.js', false)).not.toContain('--ms-enable');
    });

    it('escapes single quotes', () => {
      const out = renderCliLauncher(platform, "/o'brien/code", '/x/cli.js', false);
      expect(out).toContain(`'/o'\\''brien/code'`);
    });

    it('renders a shim that forwards or fails with 127', () => {
      const out = renderCliShim(platform, '/home/u/my bin/ipcraft');
      expect(out).toContain(CLI_SHIM_MARKER);
      expect(out).toContain(`[ -x '/home/u/my bin/ipcraft' ] || {`);
      expect(out).toContain('(missing /home/u/my bin/ipcraft)');
      expect(out).toContain('>&2; exit 127; }');
      expect(out).toContain(`exec '/home/u/my bin/ipcraft' "$@"`);
    });

    it('uses ~/.local/bin as the shim dir', () => {
      expect(externalShimDir(platform, '/home/u', {})).toBe('/home/u/.local/bin');
    });
  });

  describe('win32', () => {
    it('names the script ipcraft.cmd', () => {
      expect(cliScriptName('win32')).toBe('ipcraft.cmd');
    });

    it('renders a CRLF launcher and escapes %', () => {
      const out = renderCliLauncher(
        'win32',
        'C:\\Program Files\\Code\\Code.exe',
        'C:\\100%\\cli.js',
        false
      );
      expect(out).toContain(CLI_SHIM_MARKER);
      expect(out).toContain('set ELECTRON_RUN_AS_NODE=1');
      expect(out).toContain('"C:\\Program Files\\Code\\Code.exe" "C:\\100%%\\cli.js" %*');
      expect(out.split('\r\n').length).toBeGreaterThan(5);
      expect(out.replace(/\r\n/g, '')).not.toContain('\n');
      expect(out.endsWith('exit /b %ERRORLEVEL%\r\n')).toBe(true);
    });

    it('adds the Electron switch only for Electron', () => {
      const on = renderCliLauncher('win32', 'C:\\e.exe', 'C:\\c.js', true);
      expect(on).toContain('"C:\\e.exe" --ms-enable-electron-run-as-node "C:\\c.js" %*');
      expect(renderCliLauncher('win32', 'C:\\e.exe', 'C:\\c.js', false)).not.toContain(
        '--ms-enable'
      );
    });

    it('renders a shim that forwards or fails with 127', () => {
      const out = renderCliShim('win32', 'C:\\Users\\a b\\bin\\ipcraft.cmd');
      expect(out).toContain(CLI_SHIM_MARKER);
      expect(out).toContain('if not exist "C:\\Users\\a b\\bin\\ipcraft.cmd" (echo ');
      expect(out).toContain('1>&2& exit /b 127)');
      expect(out).toContain('call "C:\\Users\\a b\\bin\\ipcraft.cmd" %*');
      expect(out).toContain('\r\n');
    });

    it('uses LOCALAPPDATA for the shim dir and throws without it', () => {
      expect(externalShimDir('win32', 'C:\\Users\\u', { LOCALAPPDATA: 'C:\\L' })).toBe(
        'C:\\L\\Programs\\ipcraft'
      );
      expect(() => externalShimDir('win32', 'C:\\Users\\u', {})).toThrow(/LOCALAPPDATA/);
    });
  });

  describe('PATH helpers', () => {
    it('detects entries, ignoring trailing separators', () => {
      expect(isDirOnPath('/a:/home/u/.local/bin/:/b', '/home/u/.local/bin', 'linux')).toBe(true);
      expect(isDirOnPath('/a:/b', '/home/u/.local/bin', 'linux')).toBe(false);
      expect(isDirOnPath('', '/x', 'linux')).toBe(false);
    });

    it('is case-sensitive on POSIX and insensitive on win32', () => {
      expect(isDirOnPath('/A', '/a', 'linux')).toBe(false);
      expect(
        isDirOnPath('C:\\Tools;C:\\L\\Programs\\ipcraft\\', 'c:\\l\\programs\\IPCRAFT', 'win32')
      ).toBe(true);
    });

    it('adds without duplicating and handles empty values', () => {
      expect(addPathEntry('', '/x', 'linux')).toBe('/x');
      expect(addPathEntry('/a', '/x', 'linux')).toBe('/a:/x');
      expect(addPathEntry('/a:/x/', '/x', 'linux')).toBe('/a:/x/');
      expect(addPathEntry('C:\\a', 'C:\\x', 'win32')).toBe('C:\\a;C:\\x');
      expect(addPathEntry('C:\\a;', 'C:\\x', 'win32')).toBe('C:\\a;C:\\x');
    });

    it('removes matching entries only', () => {
      expect(removePathEntry('/a:/x:/b', '/x', 'linux')).toBe('/a:/b');
      expect(removePathEntry('/x', '/x', 'linux')).toBe('');
      expect(removePathEntry('', '/x', 'linux')).toBe('');
      expect(removePathEntry('C:\\a;C:\\X\;C:\\b', 'c:\\x', 'win32')).toBe('C:\\a;C:\\b');
    });
  });
});
