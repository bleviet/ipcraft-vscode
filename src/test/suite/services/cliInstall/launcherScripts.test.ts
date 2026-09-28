import {
  posixLauncher,
  windowsLauncher,
  posixShim,
  windowsShim,
  isOwnShim,
  userBinDir,
  isDirOnPath,
  windowsPathEntries,
  addWindowsPathEntry,
  removeWindowsPathEntry,
  escapePowerShellSingleQuoted,
  shellProfileFor,
  pathExprForProfile,
  pathExportLine,
  addPathBlock,
  removePathBlock,
} from '../../../../services/cliInstall/launcherScripts';

describe('launcherScripts', () => {
  describe('posixLauncher', () => {
    it('quotes execPath and cliJsPath and forwards argv', () => {
      const script = posixLauncher('/usr/bin/node', '/opt/ipcraft/dist/cli.js');
      expect(script).toBe(
        `#!/bin/sh\n# ipcraft-vscode shim\nELECTRON_RUN_AS_NODE=1 exec '/usr/bin/node' '/opt/ipcraft/dist/cli.js' "$@"\n`
      );
    });

    it('escapes spaces and parentheses (typical macOS .app bundle path) via single quotes', () => {
      const execPath =
        '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)';
      const script = posixLauncher(execPath, '/ext/dist/cli.js');
      expect(script).toContain(`'${execPath}'`);
      // A shell can round-trip this: the single-quoted segment is used as-is by sh.
      expect(script).toMatch(/exec '.*Code Helper \(Plugin\)' '\/ext\/dist\/cli\.js' "\$@"/);
    });

    it("escapes an embedded single quote as '\\''", () => {
      const script = posixLauncher("/tmp/o'brien/node", '/ext/dist/cli.js');
      expect(script).toContain(`'/tmp/o'\\''brien/node'`);
    });
  });

  describe('windowsLauncher', () => {
    it('sets ELECTRON_RUN_AS_NODE and forwards argv with CRLF line endings', () => {
      const script = windowsLauncher('C:\\Program Files\\Code\\Code.exe', 'C:\\ext\\dist\\cli.js');
      expect(script).toBe(
        '@echo off\r\n' +
          'REM ipcraft-vscode shim\r\n' +
          'setlocal\r\n' +
          'set ELECTRON_RUN_AS_NODE=1\r\n' +
          '"C:\\Program Files\\Code\\Code.exe" "C:\\ext\\dist\\cli.js" %*\r\n'
      );
    });
  });

  describe('posixShim / windowsShim', () => {
    it('posixShim forwards to the launcher path, quoted', () => {
      const shim = posixShim('/home/user/.storage/bin/ipcraft');
      expect(shim).toBe(
        `#!/bin/sh\n# ipcraft-vscode shim\nexec '/home/user/.storage/bin/ipcraft' "$@"\n`
      );
    });

    it('windowsShim forwards to the launcher path', () => {
      const shim = windowsShim('C:\\storage\\bin\\ipcraft.cmd');
      expect(shim).toBe(
        '@echo off\r\nREM ipcraft-vscode shim\r\n"C:\\storage\\bin\\ipcraft.cmd" %*\r\n'
      );
    });
  });

  describe('isOwnShim', () => {
    it('recognizes POSIX and Windows markers', () => {
      expect(isOwnShim(posixShim('/x'))).toBe(true);
      expect(isOwnShim(windowsShim('C:\\x'))).toBe(true);
    });

    it('rejects content without a marker', () => {
      expect(isOwnShim('#!/bin/sh\necho hi\n')).toBe(false);
      expect(isOwnShim('')).toBe(false);
    });
  });

  describe('userBinDir', () => {
    it('is ~/.local/bin on linux', () => {
      expect(userBinDir('linux', {}, '/home/alice')).toBe('/home/alice/.local/bin');
    });

    it('is ~/.local/bin on darwin', () => {
      expect(userBinDir('darwin', {}, '/Users/alice')).toBe('/Users/alice/.local/bin');
    });

    it('uses LOCALAPPDATA on win32 when set', () => {
      expect(
        userBinDir(
          'win32',
          { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' },
          'C:\\Users\\alice'
        )
      ).toBe('C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft');
    });

    it('falls back to homedir\\AppData\\Local on win32 when LOCALAPPDATA is unset', () => {
      expect(userBinDir('win32', {}, 'C:\\Users\\alice')).toBe(
        'C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft'
      );
    });
  });

  describe('isDirOnPath', () => {
    it('matches a POSIX PATH entry exactly', () => {
      expect(
        isDirOnPath('/home/alice/.local/bin', '/usr/bin:/home/alice/.local/bin:/bin', 'linux')
      ).toBe(true);
    });

    it('is false when the POSIX dir is absent', () => {
      expect(isDirOnPath('/home/alice/.local/bin', '/usr/bin:/bin', 'linux')).toBe(false);
    });

    it('tolerates a trailing slash on the queried POSIX dir', () => {
      expect(
        isDirOnPath('/home/alice/.local/bin/', '/usr/bin:/home/alice/.local/bin', 'darwin')
      ).toBe(true);
    });

    it('matches a Windows PATH entry case-insensitively and trailing-separator-tolerantly', () => {
      const pathEnv = 'C:\\Windows\\System32;c:\\users\\alice\\appdata\\local\\programs\\ipcraft\\';
      expect(
        isDirOnPath('C:\\Users\\Alice\\AppData\\Local\\Programs\\ipcraft', pathEnv, 'win32')
      ).toBe(true);
    });

    it('is false when the Windows dir is absent', () => {
      expect(isDirOnPath('C:\\Programs\\ipcraft', 'C:\\Windows\\System32', 'win32')).toBe(false);
    });

    it('is false for an undefined PATH', () => {
      expect(isDirOnPath('/home/alice/.local/bin', undefined, 'linux')).toBe(false);
    });
  });

  describe('windowsPathEntries / addWindowsPathEntry / removeWindowsPathEntry', () => {
    it('splits, trims, and drops empty entries', () => {
      expect(windowsPathEntries('C:\\a; C:\\b ;;C:\\c')).toEqual(['C:\\a', 'C:\\b', 'C:\\c']);
    });

    it('handles undefined as an empty PATH', () => {
      expect(windowsPathEntries(undefined)).toEqual([]);
    });

    it('addWindowsPathEntry appends when absent', () => {
      expect(addWindowsPathEntry('C:\\a;C:\\b', 'C:\\c')).toBe('C:\\a;C:\\b;C:\\c');
    });

    it('addWindowsPathEntry is a no-op when already present (case-insensitive)', () => {
      expect(addWindowsPathEntry('C:\\a;c:\\B', 'C:\\b')).toBe('C:\\a;c:\\B');
    });

    it('removeWindowsPathEntry drops a matching entry (case-insensitive, trailing slash tolerant)', () => {
      expect(removeWindowsPathEntry('C:\\a;C:\\b\\;C:\\c', 'c:\\B')).toBe('C:\\a;C:\\c');
    });

    it('removeWindowsPathEntry is a no-op when absent', () => {
      expect(removeWindowsPathEntry('C:\\a;C:\\b', 'C:\\z')).toBe('C:\\a;C:\\b');
    });
  });

  describe('escapePowerShellSingleQuoted', () => {
    it('doubles embedded single quotes', () => {
      expect(escapePowerShellSingleQuoted(`C:\\o'brien\\bin`)).toBe(`C:\\o''brien\\bin`);
    });

    it('leaves a value without quotes unchanged', () => {
      expect(escapePowerShellSingleQuoted('C:\\Users\\alice\\bin')).toBe('C:\\Users\\alice\\bin');
    });
  });

  describe('shellProfileFor', () => {
    it('is undefined on win32', () => {
      expect(shellProfileFor('win32', '/bin/bash', 'C:\\Users\\alice')).toBeUndefined();
    });

    it('is ~/.zprofile for zsh on darwin', () => {
      expect(shellProfileFor('darwin', '/bin/zsh', '/Users/alice')).toBe('/Users/alice/.zprofile');
    });

    it('is ~/.zshrc for zsh on linux', () => {
      expect(shellProfileFor('linux', '/usr/bin/zsh', '/home/alice')).toBe('/home/alice/.zshrc');
    });

    it('is ~/.bash_profile for bash on darwin', () => {
      expect(shellProfileFor('darwin', '/bin/bash', '/Users/alice')).toBe(
        '/Users/alice/.bash_profile'
      );
    });

    it('is ~/.bashrc for bash on linux', () => {
      expect(shellProfileFor('linux', '/bin/bash', '/home/alice')).toBe('/home/alice/.bashrc');
    });

    it('is undefined for an unrecognized shell (e.g. fish)', () => {
      expect(shellProfileFor('linux', '/usr/bin/fish', '/home/alice')).toBeUndefined();
    });

    it('is undefined when SHELL is unset', () => {
      expect(shellProfileFor('linux', undefined, '/home/alice')).toBeUndefined();
    });
  });

  describe('pathExprForProfile', () => {
    it('renders a dir under homedir as $HOME/...', () => {
      expect(pathExprForProfile('/home/alice/.local/bin', '/home/alice')).toBe('$HOME/.local/bin');
    });

    it('renders homedir itself as $HOME', () => {
      expect(pathExprForProfile('/home/alice', '/home/alice')).toBe('$HOME');
    });

    it('leaves a dir outside homedir untouched', () => {
      expect(pathExprForProfile('/opt/ipcraft/bin', '/home/alice')).toBe('/opt/ipcraft/bin');
    });
  });

  describe('pathExportLine', () => {
    it('builds the export line', () => {
      expect(pathExportLine('$HOME/.local/bin')).toBe('export PATH="$HOME/.local/bin:$PATH"');
    });
  });

  describe('addPathBlock / removePathBlock', () => {
    it('appends a delimited block to an empty profile', () => {
      const result = addPathBlock('', '$HOME/.local/bin');
      expect(result).toBe(
        '# >>> ipcraft >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< ipcraft <<<\n'
      );
    });

    it('appends after existing content, preserving it', () => {
      const existing = 'export EDITOR=vim\n';
      const result = addPathBlock(existing, '$HOME/.local/bin');
      expect(result).toBe(
        'export EDITOR=vim\n\n# >>> ipcraft >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< ipcraft <<<\n'
      );
    });

    it('is idempotent: adding twice yields the same result as adding once', () => {
      const once = addPathBlock('export EDITOR=vim\n', '$HOME/.local/bin');
      const twice = addPathBlock(once, '$HOME/.local/bin');
      expect(twice).toBe(once);
    });

    it('replaces a previous block if pathExpr changes', () => {
      const first = addPathBlock('export EDITOR=vim\n', '$HOME/.local/bin');
      const second = addPathBlock(first, '/opt/ipcraft/bin');
      expect(second).toBe(
        'export EDITOR=vim\n\n# >>> ipcraft >>>\nexport PATH="/opt/ipcraft/bin:$PATH"\n# <<< ipcraft <<<\n'
      );
      expect(second.match(/>>> ipcraft >>>/g)).toHaveLength(1);
    });

    it('removePathBlock is a no-op when no block is present', () => {
      const text = 'export EDITOR=vim\nexport LANG=en_US.UTF-8\n';
      expect(removePathBlock(text)).toBe(text);
    });

    it('removePathBlock removes the block and its separator blank line, keeping surrounding content', () => {
      const withBlock = addPathBlock('export EDITOR=vim\n', '$HOME/.local/bin');
      expect(removePathBlock(withBlock)).toBe('export EDITOR=vim\n');
    });

    it('removePathBlock leaves an unrelated later section untouched', () => {
      const text =
        'export EDITOR=vim\n\n# >>> ipcraft >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< ipcraft <<<\n\nexport LANG=en_US.UTF-8\n';
      expect(removePathBlock(text)).toBe('export EDITOR=vim\n\nexport LANG=en_US.UTF-8\n');
    });
  });
});
