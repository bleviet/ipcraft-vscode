import { emptySystemGraph } from '../../../domain/emptySystemGraph';
import type { SystemGraph } from '../../../domain/systemGraph';
import { diffSystemGraphs } from '../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../services/systemDiagram/readSystemDesign';
import * as fs from 'fs';
import * as path from 'path';

const fixtures = path.resolve(__dirname, '../../fixtures/system-design/diff');
const read = (file: string): SystemGraph =>
  readSystemDesign(file, file, fs.readFileSync(path.join(fixtures, file), 'utf8'))!;

describe('emptySystemGraph', () => {
  it('has the name and the format, one root level and nothing else', () => {
    const graph = emptySystemGraph('system.bd', 'vivado-bd');
    expect(graph.name).toBe('system.bd');
    expect(graph.source).toEqual({ fileName: 'system.bd', format: 'vivado-bd' });
    expect(graph.levels).toEqual({
      '/': { path: '/', name: 'system.bd', boundaryPins: [], instances: [] },
    });
    expect(graph.instances).toEqual({});
    expect(graph.nets).toEqual([]);
    expect(graph.addressSegments).toEqual([]);
    expect(graph.diagnostics).toEqual([]);
  });

  it('makes every block, port and segment of a design added in the diff', () => {
    const current = read('zynq_gpio_current.bd');
    const diff = diffSystemGraphs(emptySystemGraph('system.bd', current.source.format), current);
    expect(diff.formatsDiffer).toBe(false);
    expect(diff.instances.map((i) => i.status)).toEqual(
      Object.keys(current.instances).map(() => 'added')
    );
    expect(diff.ports.length).toBeGreaterThan(0);
    expect(diff.ports.every((p) => p.status === 'added')).toBe(true);
    expect(diff.segments.length).toBe(current.addressSegments.length);
    expect(diff.segments.length).toBeGreaterThan(0);
    expect(diff.segments.every((s) => s.status === 'added')).toBe(true);
    expect(diff.summary).toMatchObject({
      removed: 0,
      changed: 0,
      version: 0,
      renamed: 0,
      moved: 0,
    });
  });

  it('adds the blocks of a Platform Designer design too', () => {
    const current = read('nios_current.qsys');
    const diff = diffSystemGraphs(emptySystemGraph('nios.qsys', 'qsys'), current);
    expect(diff.instances.length).toBe(Object.keys(current.instances).length);
    expect(diff.instances.every((i) => i.status === 'added')).toBe(true);
  });
});
