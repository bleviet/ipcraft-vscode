import { parseArgs, usageText } from '../../../cli/argv';
import { DEFAULT_QUARTUS_DEVICE, DEFAULT_VIVADO_PART } from '../../../cli/generate';

describe('ipcraft CLI argv parsing', () => {
  it('shows help with no args', () => {
    expect(parseArgs([])).toEqual({ kind: 'help' });
  });

  it('shows help with -h / --help', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
    expect(parseArgs(['generate', '--help'])).toEqual({ kind: 'help' });
  });

  it('errors on an unknown command', () => {
    const result = parseArgs(['frobnicate']);
    expect(result.kind).toBe('error');
  });

  it('errors when the .ip.yml positional argument is missing', () => {
    const result = parseArgs(['generate', '--target', 'quartus']);
    expect(result.kind).toBe('error');
  });

  it('parses a full generate invocation matching the README example', () => {
    const result = parseArgs([
      'generate',
      'path/to.ip.yml',
      '--target',
      'quartus',
      '--lang',
      'systemverilog',
      '--out',
      'gen/',
    ]);
    expect(result).toEqual({
      kind: 'generate',
      args: {
        ipYamlPath: 'path/to.ip.yml',
        outDir: 'gen/',
        targets: ['quartus'],
        hdlLanguage: 'systemverilog',
        scaffoldPack: undefined,
        quartusDevice: undefined,
        targetPart: undefined,
      },
    });
  });

  it('defaults hdlLanguage to vhdl and targets to empty when omitted', () => {
    const result = parseArgs(['generate', 'a.ip.yml']);
    expect(result.kind).toBe('generate');
    if (result.kind === 'generate') {
      expect(result.args.hdlLanguage).toBe('vhdl');
      expect(result.args.targets).toEqual([]);
      expect(result.args.outDir).toBeUndefined();
    }
  });

  it('splits a comma-separated --target list', () => {
    const result = parseArgs(['generate', 'a.ip.yml', '--target', 'quartus,vivado']);
    expect(result.kind).toBe('generate');
    if (result.kind === 'generate') {
      expect(result.args.targets).toEqual(['quartus', 'vivado']);
    }
  });

  it('parses --pack, --quartus-device and --vivado-part', () => {
    const result = parseArgs([
      'generate',
      'a.ip.yml',
      '--pack',
      'builtin-minimal',
      '--quartus-device',
      '10M50DAF484C7G',
      '--vivado-part',
      'xc7a35tcpg236-1',
    ]);
    expect(result.kind).toBe('generate');
    if (result.kind === 'generate') {
      expect(result.args.scaffoldPack).toBe('builtin-minimal');
      expect(result.args.quartusDevice).toBe('10M50DAF484C7G');
      expect(result.args.targetPart).toBe('xc7a35tcpg236-1');
    }
  });

  it('rejects an invalid --lang value', () => {
    const result = parseArgs(['generate', 'a.ip.yml', '--lang', 'rust']);
    expect(result.kind).toBe('error');
  });

  it('parses --indent-style and --indent-size', () => {
    const result = parseArgs([
      'generate',
      'a.ip.yml',
      '--indent-style',
      'tab',
      '--indent-size',
      '4',
    ]);
    expect(result.kind).toBe('generate');
    if (result.kind === 'generate') {
      expect(result.args.indentStyle).toBe('tab');
      expect(result.args.indentSize).toBe(4);
    }
  });

  it('leaves indentStyle/indentSize undefined when omitted', () => {
    const result = parseArgs(['generate', 'a.ip.yml']);
    expect(result.kind).toBe('generate');
    if (result.kind === 'generate') {
      expect(result.args.indentStyle).toBeUndefined();
      expect(result.args.indentSize).toBeUndefined();
    }
  });

  it('rejects an invalid --indent-style value', () => {
    const result = parseArgs(['generate', 'a.ip.yml', '--indent-style', 'tabs']);
    expect(result.kind).toBe('error');
  });

  it('rejects a non-positive --indent-size value', () => {
    expect(parseArgs(['generate', 'a.ip.yml', '--indent-size', '0']).kind).toBe('error');
    expect(parseArgs(['generate', 'a.ip.yml', '--indent-size', 'nope']).kind).toBe('error');
  });

  it('rejects an unknown option', () => {
    const result = parseArgs(['generate', 'a.ip.yml', '--bogus']);
    expect(result.kind).toBe('error');
  });

  it('exposes the documented defaults in the usage text', () => {
    expect(DEFAULT_QUARTUS_DEVICE).toBe('5CSEBA6U23I7');
    expect(DEFAULT_VIVADO_PART).toBe('xc7z020clg484-1');
  });

  describe('verify command', () => {
    it('parses a verify invocation with both positionals and shared options', () => {
      const result = parseArgs([
        'verify',
        'path/to.ip.yml',
        'gen/',
        '--target',
        'quartus',
        '--lang',
        'systemverilog',
      ]);
      expect(result).toEqual({
        kind: 'verify',
        args: {
          ipYamlPath: 'path/to.ip.yml',
          generatedDir: 'gen/',
          targets: ['quartus'],
          hdlLanguage: 'systemverilog',
          scaffoldPack: undefined,
          quartusDevice: undefined,
          targetPart: undefined,
          outDir: undefined,
        },
      });
    });

    it('errors when the <generated-dir> positional is missing', () => {
      const result = parseArgs(['verify', 'a.ip.yml']);
      expect(result.kind).toBe('error');
    });

    it('errors when both positionals are missing', () => {
      const result = parseArgs(['verify']);
      expect(result.kind).toBe('error');
    });
  });

  describe('migrate', () => {
    it('parses multiple paths and --check', () => {
      expect(parseArgs(['migrate', 'a.ip.yml', 'b.ip.yml'])).toEqual({
        kind: 'migrate',
        args: { paths: ['a.ip.yml', 'b.ip.yml'], check: false },
      });
      expect(parseArgs(['migrate', '--check', 'a.ip.yml'])).toEqual({
        kind: 'migrate',
        args: { paths: ['a.ip.yml'], check: true },
      });
    });

    it('errors when no path is given', () => {
      expect(parseArgs(['migrate', '--check']).kind).toBe('error');
    });

    it('rejects generate/verify options', () => {
      expect(parseArgs(['migrate', 'a.ip.yml', '--target', 'quartus']).kind).toBe('error');
      expect(parseArgs(['migrate', 'a.ip.yml', '--out', 'gen']).kind).toBe('error');
    });

    it('rejects --check for generate and verify', () => {
      expect(parseArgs(['generate', 'a.ip.yml', '--check']).kind).toBe('error');
      expect(parseArgs(['verify', 'a.ip.yml', 'gen', '--check']).kind).toBe('error');
    });
  });
  describe('render', () => {
    it('parses a minimal invocation with the defaults', () => {
      expect(parseArgs(['render', 'bd/system.tcl', '--out', 'img/system.svg'])).toEqual({
        kind: 'render',
        args: {
          inputPath: 'bd/system.tcl',
          out: 'img/system.svg',
          level: '/',
          expand: [],
          theme: 'light',
          grid: true,
          legend: true,
          background: 'editor',
        },
      });
    });

    it('accepts an .ip.yml with the options that apply to it', () => {
      expect(
        parseArgs(['render', 'core.ip.yml', '--out', 'core.svg', '--theme', 'dark', '--no-grid'])
      ).toEqual({
        kind: 'render',
        args: expect.objectContaining({ inputPath: 'core.ip.yml', theme: 'dark', grid: false }),
      });
    });

    it.each([['--level', '/dsp'], ['--expand', '/dsp'], ['--no-legend']])(
      'rejects %s for an .ip.yml',
      (...option) => {
        const parsed = parseArgs(['render', 'core.ip.yml', '--out', 'core.svg', ...option]);
        expect(parsed.kind).toBe('error');
        expect(parsed).toEqual({
          kind: 'error',
          message: `Option '${option[0]}' is only for system designs, not for an .ip.yml`,
        });
      }
    );

    it('parses every option, with repeatable or comma-separated --expand', () => {
      expect(
        parseArgs([
          'render',
          'a.qsys',
          '--out',
          'a.svg',
          '--level',
          '/dsp',
          '--expand',
          '/dsp/a,/dsp/b',
          '--expand',
          '/dsp/c',
          '--theme',
          'dark',
          '--no-grid',
          '--no-legend',
          '--background',
          'transparent',
        ])
      ).toEqual({
        kind: 'render',
        args: {
          inputPath: 'a.qsys',
          out: 'a.svg',
          level: '/dsp',
          expand: ['/dsp/a', '/dsp/b', '/dsp/c'],
          theme: 'dark',
          grid: false,
          legend: false,
          background: 'transparent',
        },
      });
    });

    it.each([
      [['render', '--out', 'a.svg'], 'Missing required argument'],
      [['render', 'a.tcl'], "Missing required option: '--out"],
      [['render', 'a.tcl', 'b.tcl', '--out', 'a.svg'], 'Unexpected argument'],
      [['render', 'a.tcl', '--out', 'a.svg', '--scale', '2'], "Unknown option '--scale'"],
      [['render', 'a.tcl', '--out', 'a.svg', '--theme', 'blue'], 'Invalid --theme'],
      [['render', 'a.tcl', '--out', 'a.svg', '--theme'], 'Missing value for --theme'],
      [
        ['render', 'a.tcl', '--out', 'a.svg', '--expand', '--no-grid'],
        'Missing value for --expand',
      ],
      [['render', 'a.tcl', '--level', '--out', 'a.svg'], 'Missing value for --level'],
      [['render', 'a.tcl', '--out'], 'Missing value for --out'],
      [['render', 'a.tcl', '--out', 'a.svg', '--background', 'red'], 'Invalid --background'],
      [['render', 'a.tcl', '--out', 'a.svg', '--level', 'dsp'], 'Invalid --level'],
      [['render', 'a.tcl', '--out', 'a.txt'], 'the extension must be .svg'],
      [['render', 'a.tcl', '--out', 'a.png'], 'PNG and JPG output are not supported yet; use .svg'],
      [['render', 'a.tcl', '--out', 'a.JPG'], 'PNG and JPG output are not supported yet; use .svg'],
    ])('rejects %j', (argv, message) => {
      const result = parseArgs(argv);
      expect(result.kind).toBe('error');
      expect((result as { message: string }).message).toContain(message);
    });
  });

  describe('vhdl-ls', () => {
    it('defaults the root to the current directory', () => {
      expect(parseArgs(['vhdl-ls'])).toEqual({
        kind: 'vhdl-ls',
        args: { root: process.cwd(), dryRun: false, force: false },
      });
    });

    it('parses --root, --dry-run and --force', () => {
      expect(parseArgs(['vhdl-ls', '--root', 'examples', '--dry-run', '--force'])).toEqual({
        kind: 'vhdl-ls',
        args: { root: 'examples', dryRun: true, force: true },
      });
    });

    it('rejects unknown options, positionals and a missing --root value', () => {
      expect(parseArgs(['vhdl-ls', '--out', 'x']).kind).toBe('error');
      expect(parseArgs(['vhdl-ls', 'examples']).kind).toBe('error');
      expect(parseArgs(['vhdl-ls', '--root']).kind).toBe('error');
      expect(parseArgs(['vhdl-ls', '--root', '--force']).kind).toBe('error');
    });

    it('is listed in the usage text and the unknown-command message', () => {
      expect(usageText()).toContain('ipcraft vhdl-ls');
      const result = parseArgs(['bogus']);
      expect((result as { message: string }).message).toContain("'vhdl-ls'");
    });
  });
});
