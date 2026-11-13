import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import {
  SystemDesignCompare,
  type CurrentSide,
} from '../../../../../services/systemDiagram/compare/SystemDesignCompare';
import { fixtureText as tclText } from '../../../webview/systemDiagram/fixtureGraph';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';

const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design/diff');
const text = (file: string) => fs.readFileSync(path.join(fixtures, file), 'utf8');
const current = readSystemDesign('/ws/system.bd', 'system.bd', text('zynq_gpio_current.bd'))!;

function setup() {
  const enrich = jest.fn((graph: SystemGraph, _file: string) => Promise.resolve(graph));
  const logError = jest.fn();
  return { enrich, logError, compare: new SystemDesignCompare({ enrich }, logError) };
}

const side = (overrides: Partial<CurrentSide> = {}): CurrentSide => ({
  read: current,
  enriched: current,
  fellBack: false,
  ...overrides,
});

const START = ['system.bd', 'HEAD', '/ws/system.bd'] as const;

describe('SystemDesignCompare', () => {
  it('has no diff before a comparison starts', async () => {
    const { compare } = setup();
    expect(compare.active).toBe(false);
    expect(compare.diffRead(current)).toBeUndefined();
    expect(await compare.diffEnriched(side(), '/ws/system.bd')).toBeUndefined();
  });

  it('diffs the base as read against a graph as read, without enriching', () => {
    const { compare, enrich } = setup();
    compare.start(text('zynq_gpio_base.bd'), ...START);
    const result = compare.diffRead(current)!;
    expect(compare.active).toBe(true);
    expect(result.baseLabel).toBe('HEAD');
    expect(result.diff.summary).toEqual({
      added: 1,
      removed: 4,
      changed: 2,
      version: 1,
      renamed: 0,
    });
    expect(enrich).not.toHaveBeenCalled();
  });

  it('enriches the base with the document path for each enriched diff', async () => {
    const { compare, enrich } = setup();
    compare.start(text('zynq_gpio_base.bd'), ...START);
    await compare.diffEnriched(side(), '/ws/system.bd');
    await compare.diffEnriched(side(), '/ws/system.bd');
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(enrich.mock.calls[0][1]).toBe('/ws/system.bd');
    expect(enrich.mock.calls[0][0].name).toBe('zynq_gpio_system');
  });

  it('diffs the enriched base against the graph given', async () => {
    const { compare, enrich } = setup();
    enrich.mockImplementation((graph) => Promise.resolve({ ...graph, name: 'enriched' }));
    compare.start(text('zynq_gpio_base.bd'), ...START);
    const result = (await compare.diffEnriched(side(), '/ws/system.bd'))!;
    expect(result.diff.base.name).toBe('enriched');
    expect(result.diff.summary).toEqual({
      added: 1,
      removed: 4,
      changed: 2,
      version: 1,
      renamed: 0,
    });
  });

  it('compares a base that fails to enrich as read, and logs it', async () => {
    const { compare, enrich, logError } = setup();
    enrich.mockRejectedValue(new Error('boom'));
    compare.start(text('zynq_gpio_base.bd'), ...START);
    const result = (await compare.diffEnriched(side(), '/ws/system.bd'))!;
    expect(result.diff.summary.removed).toBe(4);
    expect(logError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: 'boom' })
    );
  });

  it('gives no diff when the comparison ends while the base is enriched', async () => {
    const { compare, enrich } = setup();
    let release: (graph: SystemGraph) => void = () => undefined;
    enrich.mockImplementation(
      (graph) => new Promise((resolve) => (release = () => resolve(graph)))
    );
    compare.start(text('zynq_gpio_base.bd'), ...START);
    const ended = compare.diffEnriched(side(), '/ws/system.bd');
    compare.stop();
    release(current);
    expect(await ended).toBeUndefined();
  });

  it('compares again with the new base when the base is replaced while it is enriched', async () => {
    const { compare, enrich } = setup();
    const releases: (() => void)[] = [];
    enrich.mockImplementation(
      (graph) => new Promise((resolve) => releases.push(() => resolve(graph)))
    );
    compare.start(text('zynq_gpio_base.bd'), ...START);
    const pending = compare.diffEnriched(side(), '/ws/system.bd');
    compare.start(text('zynq_gpio_base.bd'), 'system.bd', 'main', '/ws/system.bd');
    releases[0]();
    await Promise.resolve();
    await Promise.resolve();
    releases[1]();
    expect((await pending)?.baseLabel).toBe('main');
  });

  describe('when an enrichment fails', () => {
    const marked = (graph: SystemGraph): SystemGraph => ({ ...graph, name: 'enriched' });

    it('compares as read when the base falls back and the current side is enriched', async () => {
      const { compare, enrich } = setup();
      enrich.mockRejectedValue(new Error('boom'));
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const result = await compare.diffEnriched(
        side({ enriched: marked(current) }),
        '/ws/system.bd'
      );
      expect(result).toEqual(compare.diffRead(current));
      expect(result?.diff.current.name).not.toBe('enriched');
    });

    it('compares as read when the current side falls back and the base would enrich', async () => {
      const { compare, enrich } = setup();
      enrich.mockImplementation((graph) => Promise.resolve(marked(graph)));
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const result = await compare.diffEnriched(side({ fellBack: true }), '/ws/system.bd');
      expect(result).toEqual(compare.diffRead(current));
      expect(result?.diff.base.name).not.toBe('enriched');
    });
  });

  it('reads the base in the format of the document file name', () => {
    const { compare } = setup();
    compare.start(text('nios_base.qsys'), 'n.qsys', 'v1', '/ws/n.qsys');
    expect(compare.diffRead(current)!.diff.base.format).toBe('qsys');
  });

  it('reads the base in the format of the path it is given, also when it differs from the current side', () => {
    const { compare } = setup();
    compare.start(tclText, 'system.bd', 'scripts/d.tcl', '/ws/scripts/d.tcl');
    const { diff } = compare.diffRead(current)!;
    expect(diff.base.format).not.toBe(diff.current.format);
    expect(diff.formatsDiffer).toBe(true);
  });

  it('rejects a script as the base when it is read as a block design file', () => {
    const { compare } = setup();
    expect(() => compare.start(tclText, 'system.bd', 'HEAD', '/ws/system.bd')).toThrow(
      "'HEAD' is not a recognized system design"
    );
  });

  it('rejects text that is not a system design and keeps the running comparison', () => {
    const { compare } = setup();
    compare.start(text('zynq_gpio_base.bd'), ...START);
    expect(() => compare.start('puts hi', 'system.bd', 'main', '/ws/system.bd')).toThrow(
      "'main' is not a recognized system design"
    );
    expect(compare.diffRead(current)!.baseLabel).toBe('HEAD');
  });

  it('stops', () => {
    const { compare } = setup();
    compare.start(text('zynq_gpio_base.bd'), ...START);
    compare.stop();
    expect(compare.active).toBe(false);
    expect(compare.diffRead(current)).toBeUndefined();
  });
});
