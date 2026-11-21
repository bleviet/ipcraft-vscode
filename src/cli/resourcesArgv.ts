import type { ParsedArgv } from './argv';
import type { CliResourcesArgs } from './resources';

const VALUE_OPTIONS: ReadonlySet<string> = new Set(['--capacity', '--root', '--format', '--out']);

/** Usage errors of `resources` exit with 2, so a script tells them from a design that is not in the report (1). */
const usageError = (message: string): ParsedArgv => ({ kind: 'error', message, exitCode: 2 });

/** Parses `resources` argv: `<design> <report>... [--capacity <file>] [--root <report path>] [--format markdown|json] [--out <file>]`. */
export function parseResourcesArgs(rest: string[]): ParsedArgv {
  const positional: string[] = [];
  const args: Omit<CliResourcesArgs, 'design' | 'reports'> = { format: 'markdown' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = (): string => rest[++i];
    if (VALUE_OPTIONS.has(arg) && (rest[i + 1] === undefined || rest[i + 1].startsWith('--'))) {
      return usageError(`Missing value for ${arg}`);
    }
    switch (arg) {
      case '--capacity':
        args.capacity = value();
        break;
      case '--root':
        args.root = value();
        break;
      case '--out':
        args.out = value();
        break;
      case '--format': {
        const format = value();
        if (format !== 'markdown' && format !== 'json') {
          return usageError(`Invalid --format '${format}': expected 'markdown' or 'json'`);
        }
        args.format = format;
        break;
      }
      default:
        if (arg.startsWith('--')) {
          return usageError(`Unknown option '${arg}' for 'resources'`);
        }
        positional.push(arg);
    }
  }
  if (positional.length === 0) {
    return usageError('Missing required arguments: <design> <report>...');
  }
  if (positional.length === 1) {
    return usageError('Missing required argument: <report>...');
  }
  const [design, ...reports] = positional;
  return { kind: 'resources', args: { design, reports, ...args } };
}
