import { parseArgs } from '../../../cli/argv';
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
});
