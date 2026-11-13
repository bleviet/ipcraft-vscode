import type { ParsedArgv } from './argv';
import type { CliRenderArgs } from './render';

/** Whether `file` names an IP core (`.ip.yml` or `.ip.yaml`). */
export function isIpCoreFile(file: string): boolean {
  return /\.ip\.ya?ml$/i.test(file);
}

/** The image format the `--out` file extension asks for, or undefined for an unsupported one. */
export function renderOutputFormat(out: string): 'svg' | 'png' | 'jpg' | undefined {
  if (/\.svg$/i.test(out)) {
    return 'svg';
  }
  if (/\.png$/i.test(out)) {
    return 'png';
  }
  return /\.jpe?g$/i.test(out) ? 'jpg' : undefined;
}

/** The look and encoding `ipcraft render` draws with unless an option says otherwise; `diff --image` uses them as they are. */
export const RENDER_DEFAULTS = {
  theme: 'light',
  grid: true,
  legend: true,
  background: 'editor',
  scale: 2,
  quality: 90,
} as const;

const VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '--out',
  '--level',
  '--expand',
  '--select',
  '--hops',
  '--highlight',
  '--theme',
  '--background',
  '--scale',
  '--quality',
  '--workspace',
]);

/** The integer `text` names within `[min, max]`, or undefined. */
function parseIntegerInRange(text: string, min: number, max: number): number | undefined {
  const value = /^\d+$/.test(text) ? Number(text) : NaN;
  return value >= min && value <= max ? value : undefined;
}

/** The comma-separated names of a list option value, trimmed. */
function nameList(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** `--manifest <file.yml>`, which takes no input file and no other option. */
function parseManifestArgs(rest: string[]): ParsedArgv {
  if (rest.length === 1) {
    return { kind: 'error', message: 'Missing value for --manifest' };
  }
  if (rest.length !== 2 || rest[0] !== '--manifest') {
    return {
      kind: 'error',
      message:
        '--manifest renders every image of the file; it takes no input file and no other option',
    };
  }
  if (rest[1].startsWith('--')) {
    return { kind: 'error', message: 'Missing value for --manifest' };
  }
  return { kind: 'renderManifest', manifestPath: rest[1] };
}

/** Parses `render` argv: `<design> --out <file.svg|png|jpg> [--level] [--expand] [--select] [--hops] [--highlight] [--clocks] [--theme] [--no-grid] [--no-legend] [--background] [--scale] [--quality] [--workspace <dir>|--no-workspace]`, or `--manifest <file.yml>`. */
export function parseRenderArgs(rest: string[]): ParsedArgv {
  if (rest.includes('--manifest')) {
    return parseManifestArgs(rest);
  }
  const positional: string[] = [];
  const args: Omit<CliRenderArgs, 'inputPath' | 'out'> = {
    level: '/',
    expand: [],
    select: [],
    highlight: [],
    clocks: false,
    ...RENDER_DEFAULTS,
  };
  let scaleGiven = false;
  let qualityGiven = false;
  let out: string | undefined;
  let noWorkspace = false;
  const systemOnly: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = (): string => rest[++i];
    if (VALUE_OPTIONS.has(arg) && (rest[i + 1] === undefined || rest[i + 1].startsWith('--'))) {
      return { kind: 'error', message: `Missing value for ${arg}` };
    }
    switch (arg) {
      case '--out':
        out = value();
        break;
      case '--level':
        systemOnly.push(arg);
        args.level = value();
        break;
      case '--expand':
        systemOnly.push(arg);
        args.expand.push(...nameList(value()));
        break;
      case '--select':
      case '--highlight': {
        systemOnly.push(arg);
        const names = nameList(value());
        if (names.length === 0) {
          return { kind: 'error', message: `Missing value for ${arg}` };
        }
        (arg === '--select' ? args.select : args.highlight).push(...names);
        break;
      }
      case '--hops': {
        systemOnly.push(arg);
        const text = value();
        const hops = /^\d+$/.test(text) ? Number(text) : 0;
        if (hops < 1) {
          return {
            kind: 'error',
            message: `Invalid --hops '${text}': expected an integer of at least 1`,
          };
        }
        args.hops = hops;
        break;
      }
      case '--clocks':
        systemOnly.push(arg);
        args.clocks = true;
        break;
      case '--theme': {
        const theme = value();
        if (theme !== 'light' && theme !== 'dark') {
          return {
            kind: 'error',
            message: `Invalid --theme '${theme}': expected 'light' or 'dark'`,
          };
        }
        args.theme = theme;
        break;
      }
      case '--background': {
        const background = value();
        if (background !== 'editor' && background !== 'transparent') {
          return {
            kind: 'error',
            message: `Invalid --background '${background}': expected 'editor' or 'transparent'`,
          };
        }
        args.background = background;
        break;
      }
      case '--scale': {
        const text = value();
        const scale = parseIntegerInRange(text, 1, 4);
        if (scale === undefined) {
          return {
            kind: 'error',
            message: `Invalid --scale '${text}': expected an integer from 1 to 4`,
          };
        }
        scaleGiven = true;
        args.scale = scale;
        break;
      }
      case '--quality': {
        const text = value();
        const quality = parseIntegerInRange(text, 1, 100);
        if (quality === undefined) {
          return {
            kind: 'error',
            message: `Invalid --quality '${text}': expected an integer from 1 to 100`,
          };
        }
        qualityGiven = true;
        args.quality = quality;
        break;
      }
      case '--workspace':
        systemOnly.push(arg);
        args.workspace = value();
        break;
      case '--no-workspace':
        systemOnly.push(arg);
        noWorkspace = true;
        break;
      case '--no-grid':
        args.grid = false;
        break;
      case '--no-legend':
        systemOnly.push(arg);
        args.legend = false;
        break;
      default:
        if (arg.startsWith('--')) {
          return { kind: 'error', message: `Unknown option '${arg}' for 'render'` };
        }
        positional.push(arg);
    }
  }
  if (positional.length === 0) {
    return {
      kind: 'error',
      message: 'Missing required argument: <design.tcl|design.bd|design.qsys|ip.yml>',
    };
  }
  if (positional.length > 1) {
    return { kind: 'error', message: `Unexpected argument '${positional[1]}'` };
  }
  if (!out) {
    return { kind: 'error', message: "Missing required option: '--out <file.svg|png|jpg>'" };
  }
  if (isIpCoreFile(positional[0]) && systemOnly.length > 0) {
    return {
      kind: 'error',
      message: `Option '${systemOnly[0]}' is only for system designs, not for an .ip.yml`,
    };
  }
  if (noWorkspace) {
    if (args.workspace !== undefined) {
      return { kind: 'error', message: '--workspace and --no-workspace cannot be combined' };
    }
    args.workspace = false;
  }
  if (args.hops !== undefined && args.select.length === 0) {
    return { kind: 'error', message: '--hops needs --select' };
  }
  const format = renderOutputFormat(out);
  if (!format) {
    return {
      kind: 'error',
      message: `Unsupported output file '${out}': the extension must be .svg, .png, .jpg or .jpeg`,
    };
  }
  if (format === 'svg' && scaleGiven) {
    return { kind: 'error', message: '--scale applies to PNG and JPG, not to an .svg output' };
  }
  if (format !== 'jpg' && qualityGiven) {
    return { kind: 'error', message: '--quality applies to JPG output only' };
  }
  if (format === 'jpg' && args.background === 'transparent') {
    return {
      kind: 'error',
      message: 'JPG cannot be transparent; use .png or --background editor',
    };
  }
  if (!args.level.startsWith('/')) {
    return {
      kind: 'error',
      message: `Invalid --level '${args.level}': expected a path such as '/' or '/dsp_pipeline'`,
    };
  }
  return { kind: 'render', args: { inputPath: positional[0], out, ...args } };
}
