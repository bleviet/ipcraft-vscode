import { act, renderHook } from '@testing-library/react';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { useDiagramNavigation } from '../../../../webview/systemDiagram/hooks/useDiagramNavigation';
import { useIsolation } from '../../../../webview/systemDiagram/hooks/useIsolation';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const DSP = '/dsp_pipeline';
const BANK = '/dsp_pipeline/coeff_bank';
const FIR = `${DSP}/fir_compiler_0`;
const FIFO = `${BANK}/config_fifo`;

function setup(design: SystemGraph = graph) {
  return renderHook(({ current }) => useDiagramNavigation(current), {
    initialProps: { current: design },
  });
}

describe('useDiagramNavigation expansion', () => {
  it('toggles a hierarchy block without changing the level, selection or reveal', () => {
    const { result } = setup();
    act(() => result.current.select({ kind: 'instance', id: '/axi_dma_0' }));
    expect(result.current.expanded.size).toBe(0);

    act(() => result.current.toggleExpanded(DSP));
    expect([...result.current.expanded]).toEqual([DSP]);
    expect(result.current.levelPath).toBe('/');
    expect(result.current.selection).toEqual({ kind: 'instance', id: '/axi_dma_0' });

    act(() => result.current.toggleExpanded(DSP));
    expect(result.current.expanded.size).toBe(0);
  });

  it('ignores a toggle on anything but a hierarchy block', () => {
    const { result } = setup();
    const before = result.current.expanded;
    act(() => result.current.toggleExpanded('/axi_dma_0'));
    act(() => result.current.toggleExpanded('/nope'));
    expect(result.current.expanded).toBe(before);
    expect(result.current.expanded.size).toBe(0);
  });

  it('selects an instance inside an expanded block on the same level', () => {
    const { result } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.select({ kind: 'instance', id: FIR }));
    expect(result.current.levelPath).toBe('/');
    expect(result.current.selection).toEqual({ kind: 'instance', id: FIR });
    expect(result.current.selectedNodeIds).toEqual([FIR]);
  });

  it('goes to the inner level once the block is collapsed, as before', () => {
    const { result } = setup();
    act(() => result.current.select({ kind: 'instance', id: FIR }));
    expect(result.current.levelPath).toBe(DSP);

    act(() => result.current.navigate('/'));
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.select({ kind: 'instance', id: FIR }));
    expect(result.current.levelPath).toBe(DSP);
  });

  it('keeps the selected inner nodes of an expanded block when adding to the selection', () => {
    const { result } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.select({ kind: 'instance', id: '/axi_dma_0' }));
    act(() => result.current.toggleNode({ kind: 'instance', id: FIR }));
    expect(result.current.selectedNodeIds).toEqual(['/axi_dma_0', FIR]);
    expect(result.current.levelPath).toBe('/');
  });

  it('keeps the level for an outline pick inside an expanded block, and reveals there', () => {
    const { result } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.selectAndReveal({ kind: 'instance', id: FIR }, DSP));
    expect(result.current.levelPath).toBe('/');
    expect(result.current.revealRequest).toMatchObject({ levelPath: '/', selection: { id: FIR } });

    act(() => result.current.revealMatch(FIR));
    expect(result.current.levelPath).toBe('/');
    expect(result.current.revealRequest).toMatchObject({ levelPath: '/', readable: true });
  });

  it('reveals the given node for a net: itself when drawn, else its outermost block', () => {
    const { result } = setup();
    const net = { kind: 'net' as const, id: '/::axi_dma_0_M_AXIS_MM2S' };
    act(() => result.current.selectAndReveal(net));
    expect(result.current.revealRequest).toBeNull();

    act(() => result.current.selectAndReveal(net, undefined, true, FIR));
    expect(result.current.levelPath).toBe('/');
    expect(result.current.selection).toEqual(net);
    expect(result.current.revealRequest).toMatchObject({
      levelPath: '/',
      selection: { kind: 'instance', id: DSP },
      readable: true,
    });

    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.selectAndReveal(net, undefined, true, FIR));
    expect(result.current.revealRequest).toMatchObject({ selection: { id: FIR } });

    act(() => result.current.selectAndReveal(net, undefined, true, boundaryId('/', 'DDR')));
    expect(result.current.revealRequest).toMatchObject({
      selection: { kind: 'boundary', id: boundaryId('/', 'DDR') },
    });
  });

  it('opens the level of a pick that is not shown, such as a boundary pin of the block', () => {
    const { result } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() =>
      result.current.selectAndReveal({ kind: 'boundary', id: boundaryId(DSP, 'aclk') }, DSP)
    );
    expect(result.current.levelPath).toBe(DSP);
    expect(result.current.revealRequest).toMatchObject({ levelPath: DSP });

    act(() => result.current.selectAndReveal({ kind: 'instance', id: FIFO }, BANK));
    expect(result.current.levelPath).toBe(BANK);
  });

  it('keeps the expansion while navigating', () => {
    const { result } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.toggleExpanded(BANK));
    act(() => result.current.enterHierarchy(DSP));
    expect(result.current.levelPath).toBe(DSP);
    expect([...result.current.expanded].sort()).toEqual([DSP, BANK]);
    // The block's own expanded child is drawn expanded on its level, and back up too.
    act(() => result.current.select({ kind: 'instance', id: FIFO }));
    expect(result.current.levelPath).toBe(DSP);
    act(() => result.current.navigate('/'));
    expect([...result.current.expanded].sort()).toEqual([DSP, BANK]);
  });

  it('drops an expanded block that vanished from the graph', () => {
    const { result, rerender } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.toggleExpanded(BANK));
    const smaller = JSON.parse(JSON.stringify(graph)) as SystemGraph;
    delete smaller.instances[BANK];
    smaller.levels[DSP].instances = smaller.levels[DSP].instances.filter((id) => id !== BANK);
    rerender({ current: smaller });
    expect([...result.current.expanded]).toEqual([DSP]);
  });
});

describe('useIsolation with an expanded block', () => {
  function setupBoth() {
    return renderHook(() => {
      const nav = useDiagramNavigation(graph);
      const view = useIsolation(graph, nav);
      return { nav, view };
    });
  }

  it('can isolate only nodes of the level on show', () => {
    const { result } = setupBoth();
    act(() => result.current.nav.toggleExpanded(DSP));
    expect(result.current.view.canIsolate(['/axi_dma_0', DSP])).toBe(true);
    expect(result.current.view.canIsolate(['/axi_dma_0', FIR])).toBe(false);
  });

  it('keeps an isolation whose block shows the revealed inner instance', () => {
    const { result } = setupBoth();
    act(() => result.current.nav.toggleExpanded(DSP));
    act(() => result.current.view.isolate(['/axi_dma_0']));
    expect(result.current.view.isolation?.nodeIds.has(DSP)).toBe(true);
    act(() => result.current.view.revealMatch(FIR));
    expect(result.current.view.isolation).not.toBeNull();
    expect(result.current.nav.revealRequest).toMatchObject({
      levelPath: '/',
      selection: { id: FIR },
    });
  });

  it('ends an isolation that hides the block of the revealed inner instance', () => {
    const { result } = setupBoth();
    act(() => result.current.nav.toggleExpanded(DSP));
    act(() => result.current.nav.select({ kind: 'instance', id: '/axi_gpio_0' }));
    act(() => result.current.view.isolate(['/axi_gpio_0']));
    expect(result.current.view.isolation?.nodeIds.has(DSP)).toBe(false);
    act(() => result.current.view.revealMatch(FIR));
    expect(result.current.view.isolation).toBeNull();
    expect(result.current.nav.levelPath).toBe('/');
  });
});

describe('useDiagramNavigation multi-selection with nets and nodes', () => {
  const dma = { kind: 'instance', id: '/axi_dma_0' } as const;
  const port = { kind: 'boundary', id: boundaryId('/', 'DDR') } as const;
  const net = { kind: 'net', id: '/::axi_dma_0_M_AXIS_MM2S' } as const;
  const innerNet = { kind: 'net', id: `${DSP}::Conn1` } as const;

  it('toggles instances, boundary ports, and nets together in selectedItems', () => {
    const { result } = setup();
    act(() => result.current.select(dma));
    act(() => result.current.toggleSelection(port));
    act(() => result.current.toggleSelection(net));

    expect(result.current.selection).toEqual(net);
    expect(result.current.selectedItems).toEqual([dma, port, net]);
    expect(result.current.selectedNodeIds).toEqual(['/axi_dma_0', boundaryId('/', 'DDR')]);
    expect([...result.current.selectedNetIds]).toEqual(['/::axi_dma_0_M_AXIS_MM2S']);

    act(() => result.current.toggleSelection(port));
    expect(result.current.selectedItems).toEqual([dma, net]);
    expect(result.current.selection).toEqual(net);

    act(() => result.current.toggleSelection(net));
    expect(result.current.selectedItems).toEqual([dma]);
    expect(result.current.selection).toEqual(dma);
    expect([...result.current.selectedNetIds]).toEqual([]);
  });

  it('keeps nets inside an expanded hierarchy block in selectedItems', () => {
    const { result } = setup();
    act(() => result.current.toggleExpanded(DSP));
    act(() => result.current.select(dma));
    act(() => result.current.toggleSelection(innerNet));

    expect(result.current.selectedItems).toEqual([dma, innerNet]);
    expect([...result.current.selectedNetIds]).toEqual([innerNet.id]);

    // Collapsing the block hides innerNet, so only shown items remain when dma is selected.
    act(() => result.current.select(dma));
    act(() => result.current.toggleSelection(innerNet));
    act(() => result.current.toggleSelection(port));
    act(() => result.current.toggleExpanded(DSP));
    expect(result.current.selectedItems).toEqual([dma, port]);
  });
});
