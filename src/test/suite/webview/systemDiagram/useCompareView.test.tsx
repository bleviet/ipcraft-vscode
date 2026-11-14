import { act, renderHook } from '@testing-library/react';
import { useCompareView as useView } from '../../../../webview/systemDiagram/hooks/useCompareView';
import { useCompareToggles } from '../../../../webview/systemDiagram/hooks/useCompareToggles';
import type { DiagramCompare } from '../../../../shared/messages/systemDiagram';
import type { SystemGraph } from '../../../../domain/systemGraph';
import type { Ghosts } from '../../../../webview/systemDiagram/layout/unionGraph';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { compareOf, emptyDiff, zynqDiff, zynqGraph } from './compareFixtures';
import type { ChangeRow } from '../../../../services/systemDiagram/diff/changeRows';
import { systemBd } from './systemBdEdit';

const graph = zynqGraph('current');
const diff = zynqDiff();

/** The toggles and the view of a comparison, as the workbench composes them. */
const useCompareView = (
  design: SystemGraph,
  incoming: DiagramCompare | undefined,
  levelPath: string,
  isolate: (nodeIds: string[]) => void,
  ghosts?: Ghosts
) => useView(design, useCompareToggles(incoming), levelPath, isolate, ghosts);

interface Props {
  label?: string;
  level: string;
}

function setup(levelPath = '/', compared = diff) {
  const isolate = jest.fn();
  const initial: Props = { label: 'HEAD', level: levelPath };
  const view = renderHook(
    ({ label, level }: Props) =>
      useCompareView(
        graph,
        label === undefined ? undefined : compareOf(compared, label),
        level,
        isolate
      ),
    { initialProps: initial }
  );
  return { ...view, isolate };
}

describe('useCompareView', () => {
  it('has Marks on when a comparison starts, with the marks to draw', () => {
    const { result } = setup();
    expect(result.current.marksOn).toBe(true);
    expect(result.current.changes).toMatchObject({ graph, levelPath: '/' });
    expect(result.current.changes?.marks.blocks.has('/sys_ps7')).toBe(true);
    expect(result.current.details?.rows.length).toBeGreaterThan(0);
  });

  it('draws nothing without a comparison', () => {
    const { result } = setup();
    const { result: none } = renderHook(() => useCompareView(graph, undefined, '/', jest.fn()));
    expect(none.current.marksOn).toBe(false);
    expect(none.current.changes).toBeNull();
    expect(none.current.details).toBeUndefined();
    expect(none.current.changesOnly).toBeUndefined();
    expect(result.current.marksOn).toBe(true);
  });

  it('turns the marks off, and keeps the details of the changes', () => {
    const { result } = setup();
    act(() => result.current.setMarksOn(false));
    expect(result.current.marksOn).toBe(false);
    expect(result.current.changes).toBeNull();
    expect(result.current.details).toBeDefined();
    act(() => result.current.setMarksOn(true));
    expect(result.current.marksOn).toBe(true);
  });

  it('keeps the toggle while the same base is compared again, and restarts it for another base', () => {
    const { result, rerender } = setup();
    act(() => result.current.setMarksOn(false));
    rerender({ label: 'HEAD', level: '/' });
    expect(result.current.marksOn).toBe(false);
    rerender({ label: 'main', level: '/' });
    expect(result.current.marksOn).toBe(true);
  });

  it('has Marks on again when the base it was turned off for comes back', () => {
    const { result, rerender } = setup();
    act(() => result.current.setMarksOn(false));
    rerender({ label: 'main', level: '/' });
    rerender({ label: 'HEAD', level: '/' });
    expect(result.current.marksOn).toBe(true);
  });

  it('restarts the toggle when the comparison ends and starts again', () => {
    const { result, rerender } = setup();
    act(() => result.current.setMarksOn(false));
    rerender({ label: undefined, level: '/' });
    expect(result.current.marksOn).toBe(false);
    rerender({ label: 'HEAD', level: '/' });
    expect(result.current.marksOn).toBe(true);
  });

  it('isolates the marked blocks and ports of the level, or is absent without any', () => {
    const { result, rerender, isolate } = setup();
    act(() => result.current.changesOnly?.());
    expect(isolate).toHaveBeenCalledWith(['/axis_data_fifo_0', '/gpio_block', '/sys_ps7']);
    rerender({ label: 'HEAD', level: '/gpio_block' });
    act(() => result.current.changesOnly?.());
    expect(isolate).toHaveBeenLastCalledWith(['/gpio_block/axi_gpio_1']);
    rerender({ label: 'HEAD', level: '/nowhere' });
    expect(result.current.changesOnly).toBeUndefined();
  });

  it('has no Changes only while Marks is off', () => {
    const { result } = setup();
    expect(result.current.changesOnly).toBeDefined();
    act(() => result.current.setMarksOn(false));
    expect(result.current.changesOnly).toBeUndefined();
  });

  describe('Version only', () => {
    const versionPath = '/gpio_block/axi_gpio_1';
    // The fixture's version-only block also has an address change; this one has not.
    const versionOnlyDiff = {
      ...diff,
      segments: diff.segments.filter((change) => !change.segment.startsWith('gpio_block/')),
    };
    const hasRow = (rows: readonly ChangeRow[]) =>
      rows.some((row) => row.target?.kind === 'instance' && row.target.path === versionPath);

    it('is on by default, shows the incoming comparison itself and has a toggle to offer', () => {
      const incoming = compareOf(versionOnlyDiff);
      const { result } = renderHook(() => useCompareView(graph, incoming, '/', jest.fn()));
      expect(result.current.versionOnly).toBe(true);
      expect(result.current.hasVersionOnly).toBe(true);
      expect(result.current.shown).toBe(incoming);
      expect(result.current.changes?.marks.blocks.get(versionPath)?.status).toBe('version');
      expect(hasRow(result.current.details?.rows ?? [])).toBe(true);
    });

    it('drops the version-only blocks from the marks, rows and count when off, and keeps the rest', () => {
      const { result } = setup('/', versionOnlyDiff);
      act(() => result.current.setVersionOnly(false));
      expect(result.current.versionOnly).toBe(false);
      expect(result.current.shown?.diff.summary.version).toBe(0);
      expect(result.current.shown?.diff.instances.some((i) => i.status === 'version')).toBe(false);
      expect(result.current.changes?.marks.blocks.has(versionPath)).toBe(false);
      expect(hasRow(result.current.details?.rows ?? [])).toBe(false);
      expect(result.current.changes?.marks.blocks.get('/sys_ps7')).toBeDefined();
      expect(result.current.changes?.marks.blocks.get('/axis_data_fifo_0')?.status).toBe('added');
      expect(result.current.details?.rows.length).toBeGreaterThan(0);
      act(() => result.current.setVersionOnly(true));
      expect(result.current.changes?.marks.blocks.get(versionPath)?.status).toBe('version');
    });

    it('keeps the block marked as changed when its address changed too', () => {
      const { result } = setup();
      expect(result.current.changes?.marks.blocks.get(versionPath)?.status).toBe('changed');
      act(() => result.current.setVersionOnly(false));
      expect(result.current.changes?.marks.blocks.get(versionPath)).toMatchObject({
        status: 'changed',
        title: 'Address changed',
      });
    });

    it('keeps the same shown comparison across re-renders while it is off', () => {
      const incoming = compareOf(versionOnlyDiff);
      const { result, rerender } = renderHook(() =>
        useCompareView(graph, incoming, '/', jest.fn())
      );
      act(() => result.current.setVersionOnly(false));
      const first = result.current.shown;
      expect(first).not.toBe(incoming);
      rerender();
      expect(result.current.shown).toBe(first);
    });

    it('takes a hierarchy whose only inside change is version-only out of the marks', () => {
      const { result } = setup('/', versionOnlyDiff);
      expect(result.current.changes?.marks.blocks.get('/gpio_block')?.inside).toBe(1);
      act(() => result.current.setVersionOnly(false));
      expect(result.current.changes?.marks.blocks.has('/gpio_block')).toBe(false);
    });

    it('returns the incoming comparison itself when it has no version-only change', () => {
      const plain = compareOf(emptyDiff());
      const { result } = renderHook(() => useCompareView(graph, plain, '/', jest.fn()));
      expect(result.current.hasVersionOnly).toBe(false);
      act(() => result.current.setVersionOnly(false));
      expect(result.current.shown).toBe(plain);
      // Nothing is hidden, so the toolbar and the Changes tab list the version kind again.
      expect(result.current.hidingVersionOnly).toBe(false);
    });

    it('hides only while the comparison has version-only changes', () => {
      let incoming = compareOf(versionOnlyDiff);
      const { result, rerender } = renderHook(() =>
        useCompareView(graph, incoming, '/', jest.fn())
      );
      act(() => result.current.setVersionOnly(false));
      expect(result.current.hidingVersionOnly).toBe(true);
      incoming = compareOf(emptyDiff());
      rerender();
      expect(result.current.versionOnly).toBe(false);
      expect(result.current.hidingVersionOnly).toBe(false);
    });

    it('has nothing without a comparison', () => {
      const { result } = renderHook(() => useCompareView(graph, undefined, '/', jest.fn()));
      expect(result.current.shown).toBeUndefined();
      expect(result.current.hasVersionOnly).toBe(false);
    });

    it('survives a change of base, while Marks restarts', () => {
      const { result, rerender } = setup('/', versionOnlyDiff);
      act(() => {
        result.current.setVersionOnly(false);
        result.current.setMarksOn(false);
      });
      rerender({ label: 'main', level: '/' });
      expect(result.current.versionOnly).toBe(false);
      expect(result.current.marksOn).toBe(true);
      expect(result.current.changes?.marks.blocks.has(versionPath)).toBe(false);
    });
  });

  it('isolates the changed external port on a level where only a port changed', () => {
    const isolate = jest.fn();
    const base = systemBd();
    const current = systemBd((d) => {
      d.ports.led_o.left = '15';
    });
    const portOnly = diffSystemGraphs(base, current);
    const { result } = renderHook(() => useCompareView(current, compareOf(portOnly), '/', isolate));
    act(() => result.current.changesOnly?.());
    expect(isolate).toHaveBeenCalledWith(['/::led_o']);
  });
});
