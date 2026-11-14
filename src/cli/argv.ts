import type { CliDiffArgs } from './diff';
import { parseDiffArgs } from './diffArgv';
import type { CliGenerateArgs } from './generate';
import { DEFAULT_QUARTUS_DEVICE, DEFAULT_VIVADO_PART } from './generate';
import type { CliMigrateArgs } from './migrate';
import type { CliPackageArgs } from './package';
import type { CliRenderArgs } from './render';
import { parseRenderArgs } from './renderArgv';
import type { CliVhdlLsArgs } from './vhdlLs';
import type { CliVerifyArgs } from './verify';
import type { HdlLanguage } from '../generator/types';
import type { IndentStyle } from '../generator/reindent';
import { DEFAULT_INDENT_SIZE, DEFAULT_INDENT_STYLE } from '../generator/reindent';

export function usageText(): string {
  return `ipcraft — headless IPCraft HDL / vendor-project generator

Usage:
  ipcraft generate <ip.yml> [options]
  ipcraft verify <ip.yml> <generated-dir> [options]
  ipcraft package <ip.yml> --out <path> [--zip]
                                          Bundle an .ip.yml and every file it references into a
                                          self-contained folder (or .zip with --zip)
  ipcraft migrate <file>... [--check]     Upgrade .ip.yml files to the latest format version and
                                          convert legacy snake_case keys in .ip.yml / .mm.yml files
  ipcraft render <design.tcl|design.bd|design.qsys|ip.yml> --out <file.svg|png|jpg> [options]
                                          Draw one level of a system design (Vivado block design
                                          .tcl or .bd, Platform Designer .qsys or qsys-script
                                          .tcl), or the symbol of an IP core (.ip.yml), as an
                                          SVG, PNG or JPG image (the --out extension picks the
                                          format)
  ipcraft render --manifest <file.yml>    Render every image listed in a manifest file
  ipcraft diff <design> --base <git ref> [--head <git ref>] [options]
  ipcraft diff <base file> <current file> [options]
                                          Report what changed between two revisions of a system
                                          design: a revision (or the working tree) against
                                          another revision, or two files. Markdown by default
  ipcraft vhdl-ls [--root <dir>] [--dry-run] [--force]
                                          Generate a root vhdl_ls.toml that maps every VHDL file
                                          under <dir> (default: current directory) to a library

Options:
  --target <quartus|vivado>[,<...>]  Vendor target(s) to scaffold a project for
                                      (repeatable or comma-separated). Omit for
                                      RTL + testbench only.
  --lang <vhdl|systemverilog>        HDL language to generate (default: vhdl)
  --out <dir>                        [generate only] Output directory
                                      (default: alongside the .ip.yml)
  --out <file>                       [diff only] Write the report to this file (default:
                                      standard output)
  --pack <name>                      Scaffold pack to use (overrides scaffold_pack
                                      in the .ip.yml)
  --quartus-device <part>            Quartus device part (default: ${DEFAULT_QUARTUS_DEVICE})
  --vivado-part <part>                Vivado part (default: ${DEFAULT_VIVADO_PART})
  --indent-style <spaces|tab>         Indentation style for generated HDL and synthesis-tool
                                      sources (default: ${DEFAULT_INDENT_STYLE})
  --indent-size <n>                   Spaces per indentation level when --indent-style is
                                      'spaces' (default: ${DEFAULT_INDENT_SIZE}); ignored for 'tab'
  --zip                              [package only] Write a .zip file; --out is the file path
  --check                            [migrate only] Report files that need an upgrade or key
                                      conversion without writing; exit 1 if any do
  --level <path>                     [render, system designs only] Hierarchy level to draw
                                      (default: /)
  --expand <path>[,<...>]            [render, system designs only] Hierarchy blocks to draw
                                      expanded in place: blocks of the level, or of an expanded
                                      block (repeatable or comma-separated)
  --select <name>[,<...>]            [render, system designs only] Draw only these blocks (an
                                      instance name or path on the level) or external ports
                                      (port:<name>) and their neighbours (repeatable or
                                      comma-separated)
  --hops <n>                         [render, with --select] Connections from the selection to
                                      draw, an integer of at least 1 (default: 1), up to
                                      everything connected
  --highlight <name>[,<...>]         [render, system designs only] Draw these blocks or ports
                                      (port:<name>) as selected, without isolating them
  --clocks                           [render, system designs only] Draw the Clocks and resets
                                      view: pins colored by clock domain, domain strips,
                                      frequencies and clock domain crossings
  --theme <light|dark>               [render only] Image palette (default: light)
  --no-grid                          [render only] Omit the background grid
  --no-legend                        [render, system designs only] Omit the legend
  --background <editor|transparent>  [render only] Image background (default: editor);
                                      'transparent' cannot be used with a JPG
  --scale <1-4>                      [render, PNG and JPG only] Pixels per SVG unit, an integer
                                      (default: 2)
  --quality <1-100>                  [render, JPG only] JPEG quality (default: 90)
  --workspace <dir>                  [render, system designs only] Folder searched for the
                                      .ip.yml, HDL and .qsys files that define the instances
                                      (default: the design's folder)
  --no-workspace                     [render, system designs only] Draw the design as read,
                                      without those definitions
  --manifest <file.yml>              [render only] Render the images listed in the manifest;
                                      takes no input file and no other option
  --base <git ref>                   [diff only] Revision to compare the design file with
  --head <git ref>                   [diff, with --base] Compare with this revision instead
                                      of the working tree
  --format <markdown|json>           [diff only] Report format (default: markdown)
  --ignore-version-only              [diff only] Leave out blocks whose only change is the
                                      version of their IP
  --fail-on <changes|new-findings>   [diff only] Exit with 1 on any change (changes) or on new
                                      findings (new-findings); the report is still written
  --image <file.svg|png|jpg>         [diff only] Also draw the top level of the current
                                      revision with the changes marked (the extension picks
                                      the format); removed blocks are only counted
  --root <dir>                       [vhdl-ls only] Workspace root (default: current directory)
  --dry-run                          [vhdl-ls only] Print the vhdl_ls.toml instead of writing it
  --force                            [vhdl-ls only] Replace a vhdl_ls.toml that IPCraft did not
                                      write (the old file is saved to .ipcraft/backup/)
  -h, --help                          Show this help

diff reports a block as renamed (→) when it is the same block under a new name: the
same level, type, parameters and pin names, with no other difference once the rename
is applied (its address segments may still differ), and the only such pair. A block
that is renamed and also changed stays removed plus added; a move to another level is
not a rename. A block that keeps its name and moves to another parent level, with the same
type, parameters and pin names and an unchanged subtree, is reported as moved (»); a block
that is moved and renamed stays removed plus added. Example rows:
  | → | \`framebuffer_reader\` | renamed | \`frambuffer_reader\` | \`fram\`**\`e\`**\`buffer_reader\` |
  | » | \`framebuffer_reader\` | moved | \`/framebuffer_reader\` | \`/video/framebuffer_reader\` |

Examples:
  ipcraft generate path/to.ip.yml --target quartus --lang systemverilog --out gen/
  ipcraft verify path/to.ip.yml gen/ --target quartus --lang systemverilog
  ipcraft migrate path/to.ip.yml --check
  ipcraft package path/to.ip.yml --out dist/my_ip --zip
  ipcraft render bd/system.tcl --out docs/img/system.svg --expand /dsp_pipeline --theme dark
  ipcraft render bd/system.tcl --out docs/img/dma.png --select axi_dma_0 --hops 2
  ipcraft render bd/system.tcl --out docs/img/clocks.svg --clocks
  ipcraft render path/to.ip.yml --out docs/img/core.svg --no-grid
  ipcraft render bd/system.tcl --out docs/img/system.png --scale 3
  ipcraft render path/to.ip.yml --out docs/img/core.jpg --quality 80
  ipcraft render bd/system.tcl --out docs/img/system.svg --workspace .
  ipcraft render --manifest docs/images.yml
  ipcraft diff bd/system.bd --base HEAD
  ipcraft diff bd/system.bd --base main --head feature/fifo --format json --out diff.json
  ipcraft diff old/system.qsys new/system.qsys --ignore-version-only
  ipcraft diff bd/system.bd --base origin/main --fail-on new-findings
  ipcraft diff bd/system.bd --base main --image docs/img/changes.png
  ipcraft vhdl-ls --root . --dry-run
`;
}

export type ParsedArgv =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'diff'; args: CliDiffArgs }
  | { kind: 'generate'; args: CliGenerateArgs }
  | { kind: 'verify'; args: CliVerifyArgs }
  | { kind: 'migrate'; args: CliMigrateArgs }
  | { kind: 'package'; args: CliPackageArgs }
  | { kind: 'render'; args: CliRenderArgs }
  | { kind: 'renderManifest'; manifestPath: string }
  | { kind: 'vhdl-ls'; args: CliVhdlLsArgs };

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
      case '--check':
        return { error: "Option '--check' is only valid for 'migrate'" };
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

/** Parses `migrate` argv: only `--check` and positional .ip.yml / .mm.yml paths are accepted. */
function parseMigrateArgs(rest: string[]): ParsedArgv {
  const paths: string[] = [];
  let check = false;
  for (const arg of rest) {
    if (arg === '--check') {
      check = true;
    } else if (arg.startsWith('--')) {
      return { kind: 'error', message: `Unknown option '${arg}' for 'migrate'` };
    } else {
      paths.push(arg);
    }
  }
  if (paths.length === 0) {
    return { kind: 'error', message: 'Missing required argument: <ip.yml>' };
  }
  return { kind: 'migrate', args: { paths, check } };
}

/** Parses `vhdl-ls` argv: `[--root <dir>] [--dry-run] [--force]`. */
function parseVhdlLsArgs(rest: string[]): ParsedArgv {
  const args: CliVhdlLsArgs = { root: process.cwd(), dryRun: false, force: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--root') {
      i += 1;
      if (rest[i] === undefined || rest[i].startsWith('--')) {
        return { kind: 'error', message: 'Missing value for --root' };
      }
      args.root = rest[i];
    } else if (arg.startsWith('--')) {
      return { kind: 'error', message: `Unknown option '${arg}' for 'vhdl-ls'` };
    } else {
      return { kind: 'error', message: `Unexpected argument '${arg}'` };
    }
  }
  return { kind: 'vhdl-ls', args };
}

/** Parses `package` argv: `<ip.yml> --out <path> [--zip]`. */
function parsePackageArgs(rest: string[]): ParsedArgv {
  const positional: string[] = [];
  let out: string | undefined;
  let zip = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--zip') {
      zip = true;
    } else if (arg === '--out') {
      i += 1;
      out = rest[i];
    } else if (arg.startsWith('--')) {
      return { kind: 'error', message: `Unknown option '${arg}' for 'package'` };
    } else {
      positional.push(arg);
    }
  }
  if (positional.length === 0) {
    return { kind: 'error', message: 'Missing required argument: <ip.yml>' };
  }
  if (positional.length > 1) {
    return { kind: 'error', message: `Unexpected argument '${positional[1]}'` };
  }
  if (!out) {
    return { kind: 'error', message: "Missing required option: '--out <path>'" };
  }
  if (zip && !/\.zip$/i.test(out)) {
    out += '.zip';
  }
  return { kind: 'package', args: { ipYamlPath: positional[0], out, zip } };
}

/** Parses ipcraft CLI argv (excluding the node/script prefix). Pure — no I/O, no process.exit. */
export function parseArgs(argv: string[]): ParsedArgv {
  if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
    return { kind: 'help' };
  }
  const [command, ...rest] = argv;
  if (
    command !== 'generate' &&
    command !== 'verify' &&
    command !== 'migrate' &&
    command !== 'package' &&
    command !== 'render' &&
    command !== 'diff' &&
    command !== 'vhdl-ls'
  ) {
    return {
      kind: 'error',
      message: `Unknown command '${command}'. Expected 'generate', 'verify', 'migrate', 'package', 'render', 'diff' or 'vhdl-ls'.`,
    };
  }
  if (command === 'package') {
    return parsePackageArgs(rest);
  }
  if (command === 'render') {
    return parseRenderArgs(rest);
  }
  if (command === 'diff') {
    return parseDiffArgs(rest);
  }
  if (command === 'vhdl-ls') {
    return parseVhdlLsArgs(rest);
  }
  if (command === 'migrate') {
    return parseMigrateArgs(rest);
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
