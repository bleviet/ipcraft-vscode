import * as fs from 'fs';
import * as path from 'path';
import { readBdJson } from '../../../../../parser/system/BdJsonReader';
import { diffAndCheck } from './renameReference';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';

// Run against real Vivado files with: IPCRAFT_BD_SAMPLES=<dir with *.bd files> npx jest --config config/jest.config.js <this file>
const samples = process.env.IPCRAFT_BD_SAMPLES;
const describeSamples = samples ? describe : describe.skip;

const files = samples
  ? fs
      .readdirSync(samples)
      .filter((f) => f.endsWith('.bd'))
      .sort()
  : [];

const graphs = new Map(
  files.map((f) => [f, readBdJson(fs.readFileSync(path.join(samples as string, f), 'utf8'), f)])
);
const pairs = files.flatMap((a) =>
  files.filter((b) => b !== a).map((b): [string, string] => [a, b])
);
const addedPaths = (diff: ReturnType<typeof diffSystemGraphs>, status: string) =>
  diff.instances.filter((i) => i.status === status).map((i) => i.path);

describeSamples('diffSystemGraphs: real .bd files', () => {
  it('finds .bd files in IPCRAFT_BD_SAMPLES', () => {
    expect(`${samples}: ${files.length} .bd files`).not.toMatch(/: 0 \.bd files$/);
  });

  it.each(files)('finds no change between %s and itself', (file) => {
    const g = graphs.get(file)!;
    const diff = diffSystemGraphs(g, g);
    expect([diff.instances, diff.ports, diff.segments]).toEqual([[], [], []]);
    expect(diff.summary).toEqual({
      added: 0,
      removed: 0,
      changed: 0,
      version: 0,
      renamed: 0,
      moved: 0,
    });
  });

  it.each(pairs)('mirrors the diff of %s and %s', (a, b) => {
    const forward = diffSystemGraphs(graphs.get(a)!, graphs.get(b)!);
    const backward = diffSystemGraphs(graphs.get(b)!, graphs.get(a)!);
    expect(addedPaths(forward, 'added')).toEqual(addedPaths(backward, 'removed'));
    expect(addedPaths(forward, 'removed')).toEqual(addedPaths(backward, 'added'));
    expect(forward.summary.added).toBe(backward.summary.removed);
    expect(forward.summary.removed).toBe(backward.summary.added);
    expect(forward.summary.changed).toBe(backward.summary.changed);
    expect(forward.summary.version).toBe(backward.summary.version);
    expect(forward.summary.renamed).toBe(backward.summary.renamed);
    const pathsOf = (diff: ReturnType<typeof diffSystemGraphs>, side: 'path' | 'basePath') =>
      diff.instances
        .filter((i) => i.status === 'renamed')
        .map((i) => i[side])
        .sort();
    expect(pathsOf(forward, 'path')).toEqual(pathsOf(backward, 'basePath'));
    expect(pathsOf(forward, 'basePath')).toEqual(pathsOf(backward, 'path'));
  });

  it.each(pairs)(
    'checks the renames of %s and %s against the plain diff of the renamed base',
    (a, b) => {
      diffAndCheck(graphs.get(a)!, graphs.get(b)!);
    }
  );
});
