import * as fs from 'fs/promises';
import * as path from 'path';
import type { SystemGraph } from '../domain/systemGraph';
import { diffToMarkdown } from '../services/systemDiagram/diff/diffReport';
import { diffSystemGraphs } from '../services/systemDiagram/diff/diffSystemGraphs';
import { withoutVersionOnly } from '../services/systemDiagram/diff/ignoreVersionOnly';
import { readRequired } from '../services/render/renderResources';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import { readGitFile } from './gitFile';

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
}

export interface CliDiffResult {
  success: boolean;
  error?: string;
  /** The report, when it is not written to `out`. */
  report?: string;
  outputPath?: string;
}

function parseDesign(filePath: string, what: string, text: string): SystemGraph {
  const graph = readSystemDesign(filePath, path.basename(filePath), text);
  if (!graph) {
    throw new Error(`'${what}' is not a recognized system design`);
  }
  return graph;
}

async function readSide(filePath: string, ref: string | undefined): Promise<string> {
  return ref === undefined
    ? (await readRequired(path.resolve(filePath), 'Input file')).toString('utf8')
    : readGitFile(filePath, ref);
}

/** Core logic behind `ipcraft diff`: compares two revisions of a system design and returns or writes the report. */
export async function runCliDiff(args: CliDiffArgs): Promise<CliDiffResult> {
  try {
    const gitMode = args.baseRef !== undefined;
    const [baseFile, currentFile] = gitMode ? [args.files[0], args.files[0]] : args.files;
    const labels = gitMode
      ? { base: args.baseRef as string, current: args.headRef ?? 'working tree' }
      : { base: baseFile, current: currentFile };
    const baseText = await readSide(baseFile, args.baseRef);
    const currentText = await readSide(currentFile, args.headRef);
    const diff = diffSystemGraphs(
      parseDesign(baseFile, gitMode ? `${baseFile} at ${labels.base}` : baseFile, baseText),
      parseDesign(currentFile, currentFile, currentText)
    );
    const report =
      args.format === 'json'
        ? `${JSON.stringify(args.ignoreVersionOnly ? withoutVersionOnly(diff) : diff, null, 2)}\n`
        : diffToMarkdown(diff, labels, { ignoreVersionOnly: args.ignoreVersionOnly });
    if (args.out === undefined) {
      return { success: true, report };
    }
    const outputPath = path.resolve(args.out);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, report);
    return { success: true, outputPath };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
