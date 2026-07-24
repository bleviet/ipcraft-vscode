import type { CliGenerateArgs } from './generate';
import { DEFAULT_QUARTUS_DEVICE, DEFAULT_VIVADO_PART } from './generate';
import type { CliVerifyArgs } from './verify';
import type { HdlLanguage } from '../generator/types';
import type { IndentStyle } from '../generator/reindent';
import { DEFAULT_INDENT_SIZE, DEFAULT_INDENT_STYLE } from '../generator/reindent';

export function usageText(): string {
  return `ipcraft — headless IPCraft HDL / vendor-project generator

Usage:
  ipcraft generate <ip.yml> [options]
  ipcraft verify <ip.yml> <generated-dir> [options]

Options:
  --target <quartus|vivado>[,<...>]  Vendor target(s) to scaffold a project for
                                      (repeatable or comma-separated). Omit for
                                      RTL + testbench only.
  --lang <vhdl|systemverilog>        HDL language to generate (default: vhdl)
  --out <dir>                        [generate only] Output directory
                                      (default: alongside the .ip.yml)
  --pack <name>                      Scaffold pack to use (overrides scaffold_pack
                                      in the .ip.yml)
  --quartus-device <part>            Quartus device part (default: ${DEFAULT_QUARTUS_DEVICE})
  --vivado-part <part>                Vivado part (default: ${DEFAULT_VIVADO_PART})
  --indent-style <spaces|tab>         Indentation style for generated HDL and synthesis-tool
                                      sources (default: ${DEFAULT_INDENT_STYLE})
  --indent-size <n>                   Spaces per indentation level when --indent-style is
                                      'spaces' (default: ${DEFAULT_INDENT_SIZE}); ignored for 'tab'
  -h, --help                          Show this help

Examples:
  ipcraft generate path/to.ip.yml --target quartus --lang systemverilog --out gen/
  ipcraft verify path/to.ip.yml gen/ --target quartus --lang systemverilog
`;
}

export type ParsedArgv =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'generate'; args: CliGenerateArgs }
  | { kind: 'verify'; args: CliVerifyArgs };

interface CommonOptions {
  targets: string[];
  hdlLanguage: HdlLanguage;
  scaffoldPack?: string;
  quartusDevice?: string;
  targetPart?: string;
  outDir?: string;
  indentStyle?: IndentStyle;
  indentSize?: number;
}

/**
 * Parses the shared `--target/--lang/--out/--pack/--quartus-device/--vivado-part/
 * --indent-style/--indent-size` options.
 */
function parseCommonOptions(
  rest: string[]
): { positional: string[]; options: CommonOptions } | { error: string } {
  const positional: string[] = [];
  const targets: string[] = [];
  let hdlLanguage: HdlLanguage = 'vhdl';
  let outDir: string | undefined;
  let scaffoldPack: string | undefined;
  let quartusDevice: string | undefined;
  let targetPart: string | undefined;
  let indentStyle: IndentStyle | undefined;
  let indentSize: number | undefined;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const next = (): string => {
      i += 1;
      return rest[i];
    };
    switch (arg) {
      case '--target':
        targets.push(
          ...next()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );
        break;
      case '--lang':
        hdlLanguage = next() as HdlLanguage;
        break;
      case '--out':
        outDir = next();
        break;
      case '--pack':
        scaffoldPack = next();
        break;
      case '--quartus-device':
        quartusDevice = next();
        break;
      case '--vivado-part':
        targetPart = next();
        break;
      case '--indent-style':
        indentStyle = next() as IndentStyle;
        break;
      case '--indent-size':
        indentSize = Number(next());
        break;
      default:
        if (arg.startsWith('--')) {
          return { error: `Unknown option '${arg}'` };
        }
        positional.push(arg);
    }
  }

  if (hdlLanguage !== 'vhdl' && hdlLanguage !== 'systemverilog') {
    return { error: `Invalid --lang '${hdlLanguage}': expected 'vhdl' or 'systemverilog'` };
  }

  if (indentStyle !== undefined && indentStyle !== 'spaces' && indentStyle !== 'tab') {
    return { error: `Invalid --indent-style '${indentStyle}': expected 'spaces' or 'tab'` };
  }

  if (indentSize !== undefined && (!Number.isInteger(indentSize) || indentSize < 1)) {
    return { error: `Invalid --indent-size: expected a positive integer` };
  }

  return {
    positional,
    options: {
      targets,
      hdlLanguage,
      scaffoldPack,
      quartusDevice,
      targetPart,
      outDir,
      indentStyle,
      indentSize,
    },
  };
}

/** Parses ipcraft CLI argv (excluding the node/script prefix). Pure — no I/O, no process.exit. */
export function parseArgs(argv: string[]): ParsedArgv {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    return { kind: 'help' };
  }
  const [command, ...rest] = argv;
  if (command !== 'generate' && command !== 'verify') {
    return {
      kind: 'error',
      message: `Unknown command '${command}'. Expected 'generate' or 'verify'.`,
    };
  }

  const parsed = parseCommonOptions(rest);
  if ('error' in parsed) {
    return { kind: 'error', message: parsed.error };
  }
  const { positional, options } = parsed;

  if (command === 'generate') {
    const [ipYamlPath] = positional;
    if (!ipYamlPath) {
      return { kind: 'error', message: 'Missing required argument: <ip.yml>' };
    }
    return { kind: 'generate', args: { ipYamlPath, ...options } };
  }

  const [ipYamlPath, generatedDir] = positional;
  if (!ipYamlPath || !generatedDir) {
    return { kind: 'error', message: 'Missing required arguments: <ip.yml> <generated-dir>' };
  }
  return { kind: 'verify', args: { ipYamlPath, generatedDir, ...options } };
}
