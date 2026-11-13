import type { ParsedArgv } from './argv';
import type { CliDiffArgs } from './diff';

const VALUE_OPTIONS: ReadonlySet<string> = new Set([
  '--base',
  '--head',
  '--format',
  '--out',
  '--fail-on',
]);

/** Parses `diff` argv: `<design> --base <ref> [--head <ref>]` or `<base file> <current file>`, with `[--format markdown|json] [--out <file>] [--ignore-version-only] [--fail-on changes|new-findings]`. */
export function parseDiffArgs(rest: string[]): ParsedArgv {
  const positional: string[] = [];
  const args: Omit<CliDiffArgs, 'files'> = { format: 'markdown', ignoreVersionOnly: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = (): string => rest[++i];
    if (VALUE_OPTIONS.has(arg) && (rest[i + 1] === undefined || rest[i + 1].startsWith('--'))) {
      return { kind: 'error', message: `Missing value for ${arg}` };
    }
    switch (arg) {
      case '--base':
        args.baseRef = value();
        break;
      case '--head':
        args.headRef = value();
        break;
      case '--out':
        args.out = value();
        break;
      case '--format': {
        const format = value();
        if (format !== 'markdown' && format !== 'json') {
          return {
            kind: 'error',
            message: `Invalid --format '${format}': expected 'markdown' or 'json'`,
          };
        }
        args.format = format;
        break;
      }
      case '--fail-on': {
        const failOn = value();
        if (failOn !== 'changes' && failOn !== 'new-findings') {
          return {
            kind: 'error',
            message: `Invalid --fail-on '${failOn}': expected 'changes' or 'new-findings'`,
          };
        }
        args.failOn = failOn;
        break;
      }
      case '--ignore-version-only':
        args.ignoreVersionOnly = true;
        break;
      default:
        if (arg.startsWith('--')) {
          return { kind: 'error', message: `Unknown option '${arg}' for 'diff'` };
        }
        positional.push(arg);
    }
  }
  if (positional.length === 0) {
    return { kind: 'error', message: 'Missing required argument: <design>' };
  }
  if (positional.length > 2) {
    return { kind: 'error', message: `Unexpected argument '${positional[2]}'` };
  }
  if (args.headRef !== undefined && args.baseRef === undefined) {
    return { kind: 'error', message: '--head needs --base' };
  }
  if (positional.length === 1 && args.baseRef === undefined) {
    return {
      kind: 'error',
      message: "Comparing one file needs '--base <git ref>'; or give the base and the current file",
    };
  }
  if (positional.length === 2 && args.baseRef !== undefined) {
    return {
      kind: 'error',
      message: '--base and --head compare one file; give either one file or two files',
    };
  }
  return { kind: 'diff', args: { files: positional, ...args } };
}
