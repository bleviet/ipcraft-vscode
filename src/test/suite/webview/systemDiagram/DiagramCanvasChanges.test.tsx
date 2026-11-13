import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { ReactFlowProvider, useStoreApi } from '@xyflow/react';
import type { SystemGraph } from '../../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import type { ChangeContext } from '../../../../webview/systemDiagram/changeDecor';
import { buildChangeMarks } from '../../../../webview/systemDiagram/changeMarks';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { clockContextOf } from './clockContext';
import { renameDiff, renameGraph, zynqDiff, zynqGraph } from './compareFixtures';
import { stubCanvasSize } from './canvasSize';
import { fakeMeasure } from './fixtureGraph';
import { systemBd, twoClockGroups, withoutGpio0Net } from './systemBdEdit';

stubCanvasSize();

let store: ReturnType<typeof useStoreApi>;
function Probe() {
  store = useStoreApi();
  return null;
}

const handlers = {
  onSelect: jest.fn(),
  onToggleNode: jest.fn(),
  onIsolate: jest.fn(),
  onShowAll: jest.fn(),
  onEnterHierarchy: jest.fn(),
  onToggleExpand: jest.fn(),
  isolatable: jest.fn(),
  onFocusNode: jest.fn(),
  onFit: jest.fn(),
};

async function layoutOf(graph: SystemGraph, expanded: string[] = []) {
  const laidOut = await runElkLayout(
    buildElkInput(graph, '/', { measure: fakeMeasure, expanded: new Set(expanded) })
  );
  return { levelPath: '/', viewKey: '/', ...toFlowElements(laidOut, graph, '/', fakeMeasure) };
}

type Layout = Awaited<ReturnType<typeof layoutOf>>;

const contextOf = (graph: SystemGraph, diff: SystemGraphDiff): ChangeContext => ({
  marks: buildChangeMarks(diff, graph),
  graph,
  levelPath: '/',
});

function canvas(
  layout: Layout,
  graph: SystemGraph,
  changes: ChangeContext | null,
  extra: Partial<React.ComponentProps<typeof DiagramCanvas>> = {}
) {
  return (
    <ReactFlowProvider>
      <Probe />
      <DiagramCanvas
        layout={layout}
        error={null}
        selection={null}
        selectedNodeIds={[]}
        isolated={false}
        review={null}
        clocks={clockContextOf(graph)}
        changes={changes}
        focusedPin={null}
        matcher={null}
        {...handlers}
        {...extra}
      />
    </ReactFlowProvider>
  );
}

const root = (name: string): HTMLElement =>
  screen.getByText(name, { selector: '.sd-node-name' }).closest<HTMLElement>('[data-kind]')!;

describe('marks on the canvas', () => {
  const current = zynqGraph('current');
  const diff = zynqDiff();
  let layout: Layout;
  beforeAll(async () => {
    layout = await layoutOf(current);
  }, 20000);

  it('marks each kind with data-change, and a sign badge named by its title', () => {
    render(canvas(layout, current, contextOf(current, diff)));
    expect(root('axis_data_fifo_0')).toHaveAttribute('data-change', 'added');
    expect(within(root('axis_data_fifo_0')).getByRole('img', { name: 'Added' })).toHaveTextContent(
      '+'
    );
    expect(root('sys_ps7')).toHaveAttribute('data-change', 'changed');
    const changed = within(root('sys_ps7')).getByRole('img', { name: 'Changed: 1 parameter' });
    expect(changed).toHaveTextContent('~');
    expect(changed).toHaveAttribute('title', 'Changed: 1 parameter');
    expect(root('axi_periph')).not.toHaveAttribute('data-change');
    expect(within(root('axi_periph')).queryByRole('img')).toBeNull();
  });

  it('shows the changes inside a hierarchy block, with or without a status of its own', () => {
    render(canvas(layout, current, contextOf(current, diff)));
    const hier = root('gpio_block');
    expect(hier).not.toHaveAttribute('data-change');
    const count = within(hier).getByRole('img', { name: '1 change inside' });
    expect(count).toHaveTextContent('~ 1 inside');
  });

  it('puts the sign before the review and domain badges and keeps the name', () => {
    render(canvas(layout, current, contextOf(current, diff)));
    const title = root('sys_ps7').querySelector('.sd-node-title')!;
    expect(title.children[0]).toHaveClass('sd-node-name');
    expect(title.children[1]).toHaveClass('sd-change-sign');
  });

  it('marks an added external port with data-change and its sign', async () => {
    const base = zynqGraph('base');
    const reverse = diffSystemGraphs(current, base);
    render(canvas(await layoutOf(base), base, contextOf(base, reverse)));
    const port = screen.getByText('led_o').closest<HTMLElement>('.sd-port')!;
    expect(port).toHaveAttribute('data-change', 'added');
    expect(within(port).getByRole('img', { name: 'Added' })).toHaveTextContent('+');
  });

  it('marks a renamed block with an arrow and its old name', async () => {
    const graph = renameGraph();
    render(canvas(await layoutOf(graph), graph, contextOf(graph, renameDiff())));
    const block = root('axi_gpio_main');
    expect(block).toHaveAttribute('data-change', 'renamed');
    expect(within(block).getByRole('img', { name: 'Renamed from axi_gpio_0' })).toHaveTextContent(
      '→'
    );
  });

  it('colors the name of a changed pin and gives it a title, on an instance and on a frame', async () => {
    const [base, now] = [systemBd(withoutGpio0Net), systemBd()];
    const instanceCanvas = canvas(
      await layoutOf(now),
      now,
      contextOf(now, diffSystemGraphs(base, now))
    );
    const { unmount } = render(instanceCanvas);
    const added = screen.getByText('M00_AXI', { selector: '.sd-pin-label' });
    expect(added).toHaveAttribute('data-change', 'added');
    expect(added).toHaveAttribute('title', 'New pin');
    const changed = screen.getByText('S_AXI', { selector: '.sd-node[data-change] .sd-pin-label' });
    expect(changed).toHaveAttribute('data-change', 'changed');
    expect(changed).toHaveAttribute('title', 'Connection changed');
    expect(screen.getByText('S00_AXI', { selector: '.sd-pin-label' })).not.toHaveAttribute(
      'data-change'
    );
    unmount();

    const [swapBase, swapNow] = [systemBd(twoClockGroups(false)), systemBd(twoClockGroups(true))];
    render(
      canvas(
        await layoutOf(swapNow, ['/gpio_block']),
        swapNow,
        contextOf(swapNow, diffSystemGraphs(swapBase, swapNow))
      )
    );
    const frame = document.querySelector<HTMLElement>('.sd-frame')!;
    expect(frame).toHaveAttribute('data-change', 'changed');
    expect(within(frame).getByRole('img', { name: 'Changed: 2 pins inside' })).toBeInTheDocument();
    const inside = within(frame).getByText('clk', { selector: '.sd-pin-label' });
    expect(inside).toHaveAttribute('data-change', 'changed');
    expect(inside).toHaveAttribute('title', 'Connection inside changed');
  });
});

describe('marks off and on, and stable elements', () => {
  const [base, now] = [systemBd(withoutGpio0Net), systemBd()];
  const diff = diffSystemGraphs(base, now);
  let layout: Layout;
  beforeAll(async () => {
    layout = await layoutOf(now);
  }, 20000);

  // Functions are the handlers of one mount: compare what is drawn.
  const storeData = (): unknown =>
    JSON.parse(
      JSON.stringify([
        store.getState().nodes.map((n) => [n.id, n.data]),
        store.getState().edges.map((e) => [e.id, e.data]),
      ])
    );

  it('flags the new wires and no other', () => {
    render(canvas(layout, now, contextOf(now, diff)));
    const flagged = store.getState().edges.filter((e) => e.data?.changeNew === true);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.length).toBeLessThan(store.getState().edges.length);
  });

  it('draws the canvas as without a comparison while Marks is off', () => {
    const { container, unmount } = render(canvas(layout, now, null));
    const off = storeData();
    expect(container.querySelector('[data-change]')).toBeNull();
    expect(container.querySelector('.sd-change-sign, .sd-change-inside, .sd-edge-new')).toBeNull();
    expect(screen.queryByLabelText('Legend')?.textContent ?? '').not.toMatch(/Added|Changed|wire/);
    unmount();
    // The same layout without the prop at all.
    render(
      <ReactFlowProvider>
        <Probe />
        <DiagramCanvas
          layout={layout}
          error={null}
          selection={null}
          selectedNodeIds={[]}
          isolated={false}
          review={null}
          clocks={clockContextOf(now)}
          focusedPin={null}
          matcher={null}
          {...handlers}
        />
      </ReactFlowProvider>
    );
    expect(storeData()).toEqual(off);
    for (const [, data] of store.getState().nodes.map((n) => [n.id, n.data] as const)) {
      expect(data).not.toHaveProperty('change');
    }
    for (const edge of store.getState().edges) {
      expect(edge.data).not.toHaveProperty('changeNew');
    }
  });

  it('keeps every node and edge when it renders again with the same comparison', () => {
    const context = contextOf(now, diff);
    const { rerender } = render(canvas(layout, now, context));
    const nodes = new Map(store.getState().nodes.map((n) => [n.id, n]));
    const edges = new Map(store.getState().edges.map((e) => [e.id, e]));
    rerender(canvas(layout, now, context, { onSelect: jest.fn() }));
    for (const node of store.getState().nodes) {
      expect(node).toBe(nodes.get(node.id));
    }
    for (const edge of store.getState().edges) {
      expect(edge).toBe(edges.get(edge.id));
    }
  });

  it('re-creates only the selected block when a block is selected, marks on', () => {
    const context = contextOf(now, diff);
    const { rerender } = render(canvas(layout, now, context));
    const before = new Map(store.getState().nodes.map((n) => [n.id, n]));
    const edgesBefore = new Map(store.getState().edges.map((e) => [e.id, e]));
    rerender(
      canvas(layout, now, context, {
        selection: { kind: 'instance', id: '/sys_ps7' },
        selectedNodeIds: ['/sys_ps7'],
      })
    );
    expect(
      store
        .getState()
        .nodes.filter((n) => n !== before.get(n.id))
        .map((n) => n.id)
    ).toEqual(['/sys_ps7']);
    for (const edge of store.getState().edges) {
      expect(edge).toBe(edgesBefore.get(edge.id));
    }
  });
});

describe('the legend while marks are on', () => {
  it('lists the kinds on the level, the new wire and the removed entry, which opens the Changes tab', async () => {
    const current = zynqGraph('current');
    const onOpenChanges = jest.fn();
    render(
      canvas(await layoutOf(current), current, contextOf(current, zynqDiff()), { onOpenChanges })
    );
    const legend = screen.getByLabelText('Legend');
    expect(legend).toHaveTextContent('+ Added');
    expect(legend).toHaveTextContent('~ Changed');
    expect(legend).not.toHaveTextContent('Renamed');
    const removed = within(legend).getByRole('button', { name: '− 2 removed, see Changes' });
    removed.click();
    expect(onOpenChanges).toHaveBeenCalledTimes(1);
  });
});
