import * as fs from 'fs/promises';
import * as path from 'path';
import { emptySystemGraph } from '../domain/emptySystemGraph';
import type { SystemGraph } from '../domain/systemGraph';
import type { FindingsDiff, SystemGraphDiff } from '../domain/systemGraphDiff';
import { diffFindings } from '../services/systemDiagram/diff/diffFindings';
import { diffToMarkdown } from '../services/systemDiagram/diff/diffReport';
import { diffSystemGraphs } from '../services/systemDiagram/diff/diffSystemGraphs';
import { changeCount, withoutVersionOnly } from '../services/systemDiagram/diff/ignoreVersionOnly';
import type { RenderRoots } from '../services/render/imageEncoding';
import { readRequired } from '../services/render/renderResources';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import { writeDiffImage } from './diffImage';
import { readGitFile, readGitFileStrict, type GitFile } from './gitFile';

export interface CliDiffArgs {
  /** One design (compared with `--base`) or the base file and the current file. */
  files: string[];
  /** Git revision of the base; with one file. */
  baseRef?: string;
  /** Git revision of the current side; default: the working tree. */
  headRef?: string;
  format: 'markdown' | 'json';
  /** Report file; default: standard output. */
  out?: string;
  ignoreVersionOnly: boolean;
  /** Make the command fail (exit 1) on any change or on new findings. */
  failOn?: 'changes' | 'new-findings';
  /** Image file (`.svg`, `.png`, `.jpg`) of the top level of the current revision with the change marks. */
  image?: string;
}

export interface CliDiffResult {
  success: boolean;
  error?: string;
  /** The report, when it is not written to `out`. */
  report?: string;
  outputPath?: string;
  /** The image file written for `image`. */
  imagePath?: string;
  /** Why the image could not be written; the report is still produced. */
  imageError?: string;
  /** Why `--fail-on` failed the check, e.g. `3 changes (--fail-on changes)`. */
  failed?: string;
}

function parseDesign(filePath: string, what: string, text: string): SystemGraph {
  const graph = readSystemDesign(filePath, path.basename(filePath), text);
  if (!graph) {
    throw new Error(`'${what}' is not a recognized system design`);
  }
  return graph;
}

/** The current side: the file or its text at `ref`; it must exist. */
async function readCurrent(filePath: string, ref: string | undefined): Promise<string> {
  return ref === undefined
    ? (await readRequired(path.resolve(filePath), 'Input file')).toString('utf8')
    : readGitFileStrict(filePath, ref);
}

/** The base side; a file in git mode may have been renamed or not yet exist at the base revision. */
async function readBase(
  filePath: string,
  ref: string | undefined,
  headRef: string | undefined
): Promise<GitFile> {
  return ref === undefined
    ? { text: await readCurrent(filePath, undefined) }
    : readGitFile(filePath, ref, headRef);
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/** Why `--fail-on` fails the check, with the option (`3 changes (--fail-on changes)`), or undefined when it passes. */
export function failOnReason(
  diff: SystemGraphDiff,
  findings: FindingsDiff,
  failOn: CliDiffArgs['failOn'],
  ignoreVersionOnly: boolean
): string | undefined {
  if (failOn === 'changes') {
    const total = changeCount((ignoreVersionOnly ? withoutVersionOnly(diff) : diff).summary);
    return total > 0 ? `${plural(total, 'change')} (--fail-on changes)` : undefined;
  }
  if (failOn === 'new-findings' && findings.new.length > 0) {
    return `${plural(findings.new.length, 'new finding')} (--fail-on new-findings)`;
  }
  return undefined;
}

/** Core logic behind `ipcraft diff`: compares two revisions of a system design, returns or writes the report, and draws `image`. */
/**
 * `loadRoots` finds the installation's resources (fonts, rasterizer); it is called only for
 * `--image`, and its error becomes the image's error.
 */
export async function runCliDiff(
  args: CliDiffArgs,
  loadRoots?: () => RenderRoots
): Promise<CliDiffResult> {
  try {
    const gitMode = args.baseRef !== undefined;
    const [baseFile, currentFile] = gitMode ? [args.files[0], args.files[0]] : args.files;
    const labels = gitMode
      ? { base: args.baseRef as string, current: args.headRef ?? 'working tree' }
      : { base: baseFile, current: currentFile };
    const baseSide = await readBase(baseFile, args.baseRef, args.headRef);
    const currentText = await readCurrent(currentFile, args.headRef);
    const named = (file: string, ref: string | undefined) =>
      ref === undefined ? file : `${file} at ${ref}`;
    const parsedBase =
      'text' in baseSide
        ? parseDesign(baseFile, named(baseFile, args.baseRef), baseSide.text)
        : undefined;
    const current = parseDesign(currentFile, named(currentFile, args.headRef), currentText);
    const base = parsedBase ?? emptySystemGraph(current.name, current.source.format);
    const diff = diffSystemGraphs(base, current);
    if ('missing' in baseSide) {
      diff.base.missing = true;
    } else if (baseSide.path !== undefined) {
      diff.base.path = baseSide.path;
    }
    const findings = diffFindings(base, current, diff);
    const report =
      args.format === 'json'
        ? `${JSON.stringify({ ...(args.ignoreVersionOnly ? withoutVersionOnly(diff) : diff), findings }, null, 2)}\n`
        : diffToMarkdown(diff, labels, { ignoreVersionOnly: args.ignoreVersionOnly, findings });
    const failed = failOnReason(diff, findings, args.failOn, args.ignoreVersionOnly);
    const result: CliDiffResult = { success: true, ...(failed !== undefined && { failed }) };
    if (args.out === undefined) {
      result.report = report;
    } else {
      result.outputPath = path.resolve(args.out);
      await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
      await fs.writeFile(result.outputPath, report);
    }
    if (args.image !== undefined) {
      try {
        if (!loadRoots) {
          throw new Error('The resource roots are required to draw an image');
        }
        const marked = args.ignoreVersionOnly ? withoutVersionOnly(diff) : diff;
        result.imagePath = await writeDiffImage(args.image, current, marked, loadRoots());
      } catch (err) {
        // The report is already written or held: a failed image must not lose it.
        result.imageError = err instanceof Error ? err.message : String(err);
      }
    }
    return result;
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
