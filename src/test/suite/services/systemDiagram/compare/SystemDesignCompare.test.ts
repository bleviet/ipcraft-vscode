import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import * as diffFindings from '../../../../../services/systemDiagram/diff/diffFindings';
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
  // The revision of the definitions: a test bumps it to change them.
  const enricher = { revision: '1', enrich };
  return { enrich, enricher, logError, compare: new SystemDesignCompare(enricher, logError) };
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
      moved: 0,
    });
    expect(enrich).not.toHaveBeenCalled();
  });

  it('enriches the base with the document path', async () => {
    const { compare, enrich } = setup();
    compare.start(text('zynq_gpio_base.bd'), ...START);
    await compare.diffEnriched(side(), '/ws/system.bd');
    expect(enrich).toHaveBeenCalledTimes(1);
    expect(enrich.mock.calls[0][1]).toBe('/ws/system.bd');
    expect(enrich.mock.calls[0][0].name).toBe('zynq_gpio_system');
  });

  describe('the enriched base', () => {
    it('is enriched once for several diffs while the definitions are unchanged', async () => {
      const { compare, enrich } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const first = await compare.diffEnriched(side(), '/ws/system.bd');
      const again = await compare.diffEnriched(side(), '/ws/system.bd');
      const [parallel] = await Promise.all([
        compare.diffEnriched(side(), '/ws/system.bd'),
        compare.diffEnriched(side(), '/ws/system.bd'),
      ]);
      expect(enrich).toHaveBeenCalledTimes(1);
      expect(again).toEqual(first);
      expect(parallel).toEqual(first);
    });

    it('is enriched again after the definitions changed', async () => {
      const { compare, enrich, enricher } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      await compare.diffEnriched(side(), '/ws/system.bd');
      enricher.revision = '2';
      await compare.diffEnriched(side(), '/ws/system.bd');
      await compare.diffEnriched(side(), '/ws/system.bd');
      expect(enrich).toHaveBeenCalledTimes(2);
    });

    it('is enriched again for another design file', async () => {
      const { compare, enrich } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      await compare.diffEnriched(side(), '/ws/system.bd');
      await compare.diffEnriched(side(), '/ws/other/system.bd');
      expect(enrich).toHaveBeenCalledTimes(2);
    });

    it('is enriched again when the definitions changed while it was enriched', async () => {
      const { compare, enrich, enricher } = setup();
      const releases: (() => void)[] = [];
      enrich.mockImplementation(
        (graph) => new Promise((resolve) => releases.push(() => resolve(graph)))
      );
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const pending = compare.diffEnriched(side(), '/ws/system.bd');
      // A definition changes while the first enrichment is running.
      enricher.revision = '2';
      releases[0]();
      await pending;
      const next = compare.diffEnriched(side(), '/ws/system.bd');
      releases[1]();
      await next;
      expect(enrich).toHaveBeenCalledTimes(2);
      // The second enrichment ran under the new revision, so it is reused.
      enrich.mockImplementation((graph) => Promise.resolve(graph));
      await compare.diffEnriched(side(), '/ws/system.bd');
      expect(enrich).toHaveBeenCalledTimes(2);
    });

    it('is not kept when its enrichment failed', async () => {
      const { compare, enrich, logError } = setup();
      enrich.mockRejectedValueOnce(new Error('boom'));
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const failed = (await compare.diffEnriched(side(), '/ws/system.bd'))!;
      expect(failed.diff.base.name).toBe('zynq_gpio_system');
      expect(logError).toHaveBeenCalledTimes(1);
      await compare.diffEnriched(side(), '/ws/system.bd');
      await compare.diffEnriched(side(), '/ws/system.bd');
      expect(enrich).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('is enriched for a new base after another start, and again after stop and start', async () => {
      const { compare, enrich } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      await compare.diffEnriched(side(), '/ws/system.bd');
      compare.start(text('zynq_gpio_base.bd'), 'system.bd', 'main', '/ws/system.bd');
      await compare.diffEnriched(side(), '/ws/system.bd');
      expect(enrich).toHaveBeenCalledTimes(2);
      compare.stop();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      await compare.diffEnriched(side(), '/ws/system.bd');
      expect(enrich).toHaveBeenCalledTimes(3);
    });

    it('is not enriched when the current side fell back', async () => {
      const { compare, enrich } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      await compare.diffEnriched(side({ fellBack: true }), '/ws/system.bd');
      expect(enrich).not.toHaveBeenCalled();
    });
  });

  describe('findings', () => {
    const led = { kind: 'undriven', level: '/', instance: null, pin: 'led_o', label: 'led_o' };

    it('carries the findings that differ from the base as read', () => {
      const { compare } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const result = compare.diffRead(current)!;
      expect(result.findings).toEqual({ new: [], resolved: [led] });
    });

    it('carries the findings that differ from the enriched base', async () => {
      const { compare } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const result = (await compare.diffEnriched(side(), '/ws/system.bd'))!;
      expect(result.findings).toEqual({ new: [], resolved: [led] });
    });

    it('compares read with read, and enriched with enriched, for the findings too', async () => {
      const { compare, enrich } = setup();
      // The definitions give a block with a known pin list one more pin that no net touches.
      const withExtraPin = (graph: SystemGraph): SystemGraph => {
        const [path, block] = Object.entries(graph.instances).find(
          ([, instance]) => instance.kind === 'hier'
        )!;
        const pin = { ...block.pins[0], name: 'extra_pin' };
        return {
          ...graph,
          instances: { ...graph.instances, [path]: { ...block, pins: [...block.pins, pin] } },
        };
      };
      enrich.mockImplementation((graph) => Promise.resolve(withExtraPin(graph)));
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const names = (result: { findings: { resolved: { kind: string }[] } }) =>
        JSON.stringify(result.findings.resolved);
      const read = compare.diffRead(current)!;
      expect(names(read)).not.toContain('extra_pin');
      // The extra pin is in the enriched base only: the current side without it resolves it.
      const unequal = (await compare.diffEnriched(side(), '/ws/system.bd'))!;
      expect(names(unequal)).toContain('extra_pin');
      // Both sides enriched alike: the definitions are no difference.
      const enrichedCurrent = withExtraPin(current);
      const equal = (await compare.diffEnriched(
        side({ read: current, enriched: enrichedCurrent }),
        '/ws/system.bd'
      ))!;
      expect(equal.findings).toEqual(read.findings);
    });

    it('analyses the base once for several edits, and the current side for each', async () => {
      const { compare } = setup();
      const analyse = jest.spyOn(diffFindings, 'findingsOf');
      try {
        compare.start(text('zynq_gpio_base.bd'), ...START);
        const first = (await compare.diffEnriched(side(), '/ws/system.bd'))!;
        expect(analyse).toHaveBeenCalledTimes(2);
        const edited = { ...current };
        const second = (await compare.diffEnriched(
          side({ read: edited, enriched: edited }),
          '/ws/system.bd'
        ))!;
        expect(analyse).toHaveBeenCalledTimes(3);
        expect(second.findings).toEqual(first.findings);
        // The same graphs again are not analysed again.
        await compare.diffEnriched(side({ read: edited, enriched: edited }), '/ws/system.bd');
        expect(analyse).toHaveBeenCalledTimes(3);
      } finally {
        analyse.mockRestore();
      }
    });

    it('analyses the base again for a new base', () => {
      const { compare } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      const before = compare.diffRead(current)!;
      expect(compare.diffRead(current)!.findings.resolved[0]).toBe(before.findings.resolved[0]);
      compare.start(text('zynq_gpio_base.bd'), ...START);
      expect(compare.diffRead(current)!.findings.resolved[0]).not.toBe(before.findings.resolved[0]);
    });
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
      moved: 0,
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

  describe('a base that is not the file read under its own path', () => {
    it('takes a missing file as an empty design in the format of the current side, so everything is added', () => {
      const { compare } = setup();
      compare.start('', 'system.bd', 'HEAD~3', '/ws/system.bd', { missing: true });
      expect(compare.active).toBe(true);
      const { diff, baseLabel, findings } = compare.diffRead(current)!;
      expect(baseLabel).toBe('HEAD~3');
      expect(diff.base).toEqual({ name: current.name, format: 'vivado-bd', missing: true });
      expect(diff.formatsDiffer).toBe(false);
      expect(diff.summary.added).toBe(
        Object.keys(current.instances).length + diff.ports.length + current.addressSegments.length
      );
      expect(diff.ports.length).toBeGreaterThan(0);
      expect(diff.summary).toMatchObject({ removed: 0, changed: 0, renamed: 0, moved: 0 });
      expect(diff.instances.every((i) => i.status === 'added')).toBe(true);
      expect(findings.resolved).toEqual([]);
    });

    it('does not read the text of a missing file, nor enrich it, and compares with the current side as shown', async () => {
      const { compare, enrich } = setup();
      compare.start('puts not-a-design', 'system.bd', 'HEAD~3', '/ws/system.bd', { missing: true });
      const enriched = { ...current, name: 'enriched' };
      const result = await compare.diffEnriched(side({ enriched }), '/ws/system.bd');
      expect(enrich).not.toHaveBeenCalled();
      expect(result!.diff.current.name).toBe('enriched');
      expect(result!.diff.base.missing).toBe(true);
      const fellBack = await compare.diffEnriched(
        side({ enriched, fellBack: true }),
        '/ws/system.bd'
      );
      expect(fellBack!.diff.current.name).toBe(current.name);
    });

    it('records the old path of a file read under another one, as read and as enriched', async () => {
      const { compare } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START, { renamedFrom: 'old/system.bd' });
      expect(compare.diffRead(current)!.diff.base.path).toBe('old/system.bd');
      expect(compare.diffRead(current)!.diff.base).not.toHaveProperty('missing');
      const enriched = await compare.diffEnriched(side(), '/ws/system.bd');
      expect(enriched!.diff.base.path).toBe('old/system.bd');
    });

    it('leaves the sides as they are without an origin', () => {
      const { compare } = setup();
      compare.start(text('zynq_gpio_base.bd'), ...START);
      expect(compare.diffRead(current)!.diff.base).not.toHaveProperty('path');
      expect(compare.diffRead(current)!.diff.base).not.toHaveProperty('missing');
    });
  });
});
