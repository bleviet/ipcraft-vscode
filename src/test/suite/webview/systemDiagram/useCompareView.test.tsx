import { act, renderHook } from '@testing-library/react';
import { useCompareView } from '../../../../webview/systemDiagram/hooks/useCompareView';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { compareOf, zynqDiff, zynqGraph } from './compareFixtures';
import { systemBd } from './systemBdEdit';

const graph = zynqGraph('current');
const diff = zynqDiff();

interface Props {
  label?: string;
  level: string;
}

function setup(levelPath = '/') {
  const isolate = jest.fn();
  const initial: Props = { label: 'HEAD', level: levelPath };
  const view = renderHook(
    ({ label, level }: Props) =>
      useCompareView(
        graph,
        label === undefined ? undefined : compareOf(diff, label),
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
