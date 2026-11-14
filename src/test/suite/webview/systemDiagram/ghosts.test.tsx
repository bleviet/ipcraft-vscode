import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { unionAdditions } from '../../../../services/systemDiagram/diff/unionAdditions';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { changeDecor, type ChangeContext } from '../../../../webview/systemDiagram/changeDecor';
import { buildChangeMarks, markedNodeIds } from '../../../../webview/systemDiagram/changeMarks';
import { CompareControl } from '../../../../webview/systemDiagram/CompareControl';
import { DetailsPanel } from '../../../../webview/systemDiagram/DetailsPanel';
import { DiagramCanvas } from '../../../../webview/systemDiagram/DiagramCanvas';
import { DiagramLegend } from '../../../../webview/systemDiagram/DiagramLegend';
import { ElkEdge } from '../../../../webview/systemDiagram/ElkEdge';
import {
  buildElkInput,
  toFlowElements,
  type DiagramFlowEdge,
} from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { withUnion, type Ghosts } from '../../../../webview/systemDiagram/layout/unionGraph';
import { MINIMAP_COLORS, minimapColor } from '../../../../webview/systemDiagram/minimap';
import { NodeHeader } from '../../../../webview/systemDiagram/NodeHeader';
import { OutlineTree } from '../../../../webview/systemDiagram/OutlineTree';
import { useDiagramNavigation } from '../../../../webview/systemDiagram/hooks/useDiagramNavigation';
import { stubCanvasSize } from './canvasSize';
import { clockContextOf } from './clockContext';
import { compareOf, zynqDiff, zynqGraph } from './compareFixtures';
import { fakeMeasure } from './fixtureGraph';
import { systemBd, withoutGpioBlock, withoutNestedSlave } from './systemBdEdit';

stubCanvasSize();

/** A comparison of `base` with `now`, as the viewer shows it with the ghosts of what only the base has. */
function comparison(base: SystemGraph, now: SystemGraph, shown = true) {
  const diff = diffSystemGraphs(base, now);
  const union = withUnion(now, unionAdditions(base, now, diff));
  const ghosts = shown ? union.ghosts : undefined;
  const marks = buildChangeMarks(diff, now, ghosts);
  return {
    diff,
    now,
    union,
    marks,
    context: { marks, graph: now, levelPath: '/' } satisfies ChangeContext,
    rows: changeRows(diff, { ignoreVersionOnly: false }),
  };
}

async function layoutOf(graph: SystemGraph, ghosts: Ghosts) {
  const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: fakeMeasure }));
  return {
    levelPath: '/',
    viewKey: '/',
    ...toFlowElements(laidOut, graph, '/', fakeMeasure, undefined, ghosts),
  };
}

const [zynqBase, zynqNow] = [zynqGraph('base'), zynqGraph('current')];

describe('the marks of the ghosts', () => {
  const { marks, context, union, diff } = comparison(zynqBase, zynqNow);

  it('marks a ghost block and port removed, and the pin its neighbour lost, with the net of the wire', () => {
    expect(marks.blocks.get('/axi_gpio_0')).toMatchObject({
      status: 'removed',
      title: 'Removed: only in the base',
    });
    expect(marks.ports.get('led_o')).toEqual({
      status: 'removed',
      title: 'Removed: only in the base',
    });
    // A block that exists in both has the pin, not a status.
    expect(marks.blocks.get('/axi_periph')).toMatchObject({ pins: { M00_AXI: 'removed' } });
    expect(marks.blocks.get('/axi_periph')?.status).toBeUndefined();
    expect([...marks.removedNets]).toEqual(['ghost:/::periph_gpio0']);
  });

  it('marks nothing as removed when the ghosts are not shown, and still counts what was removed', () => {
    const hidden = comparison(zynqBase, zynqNow, false).marks;
    expect(hidden.blocks.has('/axi_gpio_0')).toBe(false);
    expect(hidden.ports.has('led_o')).toBe(false);
    expect(hidden.removedNets.size).toBe(0);
    expect(hidden.removed.get('/')).toBe(marks.removed.get('/'));
  });

  it('leaves the ghosts out of the marked nodes of the level: Changes only isolates what the design has', () => {
    expect(markedNodeIds(marks, zynqNow, '/')).not.toContain('/axi_gpio_0');
    expect(markedNodeIds(marks, zynqNow, '/')).not.toContain('/::led_o');
  });

  it('decorates the ghost nodes, the pin and the wire, and puts the removed kind and wire in the legend', async () => {
    const layout = await layoutOf(union.graph, union.ghosts);
    const decor = changeDecor(layout, context);
    expect(decor.nodes.get('/axi_gpio_0')).toEqual({
      status: 'removed',
      title: 'Removed: only in the base',
    });
    expect(decor.nodes.get('/::led_o')).toMatchObject({ status: 'removed' });
    expect(decor.nodes.get('/axi_periph')).toEqual({ pins: { M00_AXI: { kind: 'removed' } } });
    expect([...(decor.removedEdgeIds ?? [])]).toEqual(['ghost:/::periph_gpio0#1']);
    expect(decor.legend.kinds).toEqual(['added', 'removed', 'changed']);
    expect(decor.legend.removedWire).toBe(true);
    expect(decor.newEdgeIds.has('ghost:/::periph_gpio0#1')).toBe(false);
    expect(diff.summary.removed).toBeGreaterThan(0);
  });

  it('has no removed kind or wire in the legend without ghosts', async () => {
    const plain = comparison(zynqBase, zynqNow, false);
    const decor = changeDecor(await layoutOf(zynqNow, withUnion(zynqNow, undefined).ghosts), {
      ...plain.context,
    });
    expect(decor.legend.kinds).not.toContain('removed');
    expect(decor.legend).not.toHaveProperty('removedWire');
    expect(decor.removedEdgeIds?.size ?? 0).toBe(0);
  });

  it('colors a ghost on the minimap with the removed color', () => {
    const node = {
      id: '/axi_gpio_0',
      type: 'instance',
      position: { x: 0, y: 0 },
      data: { instance: { kind: 'ip', name: 'x' }, change: { status: 'removed' } },
    } as unknown as Parameters<typeof minimapColor>[0];
    expect(minimapColor(node, null)).toBe(MINIMAP_COLORS.removed);
    expect(MINIMAP_COLORS.removed).toBe('var(--sd-change-removed)');
  });
});

describe('a ghost on the canvas', () => {
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
  beforeEach(() => jest.clearAllMocks());

  function canvas(
    layout: Awaited<ReturnType<typeof layoutOf>>,
    graph: SystemGraph,
    changes: ChangeContext | null
  ) {
    return (
      <ReactFlowProvider>
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
        />
      </ReactFlowProvider>
    );
  }
  const nodeOf = (name: string) =>
    screen.getByText(name, { selector: '.sd-node-name' }).closest<HTMLElement>('[data-kind]')!;

  it('draws the block removed, with the minus sign and its title, and the ghost port and pin too', async () => {
    const { union, context, now } = comparison(zynqBase, zynqNow);
    render(canvas(await layoutOf(union.graph, union.ghosts), now, context));
    const block = nodeOf('axi_gpio_0');
    expect(block).toHaveAttribute('data-change', 'removed');
    expect(within(block).getByRole('img', { name: 'Removed: only in the base' })).toHaveTextContent(
      '−'
    );
    const port = screen.getByText('led_o').closest<HTMLElement>('.sd-port')!;
    expect(port).toHaveAttribute('data-change', 'removed');
    expect(within(port).getByRole('img', { name: /^Removed/ })).toHaveTextContent('−');
    const pin = screen.getByText('M00_AXI', { selector: '.sd-pin-label' });
    expect(pin).toHaveAttribute('data-change', 'removed');
    expect(pin).toHaveAttribute('title', 'Removed pin');
    expect(document.querySelector('.sd-edge-removed')).not.toBeNull();
  });

  it('keeps the row of a ghost pin empty while its ghost is not drawn', async () => {
    const { union, now } = comparison(zynqBase, zynqNow);
    // Marks off, or Removed off: the layout is the union's, the marks carry no ghost.
    const hidden = comparison(zynqBase, zynqNow, false).context;
    render(canvas(await layoutOf(union.graph, union.ghosts), now, hidden));
    expect(screen.queryByText('M00_AXI', { selector: '.sd-pin-label' })).toBeNull();
    expect(screen.getByText('S00_AXI', { selector: '.sd-pin-label' })).toBeInTheDocument();
  });

  describe('a removed hierarchy', () => {
    const [base, now] = [systemBd(), systemBd(withoutGpioBlock)];
    let drawn: ReturnType<typeof comparison>;
    let layout: Awaited<ReturnType<typeof layoutOf>>;
    beforeAll(async () => {
      drawn = comparison(base, now);
      layout = await layoutOf(drawn.union.graph, drawn.union.ghosts);
    }, 20000);

    it('has no button to expand it, and a subtitle without a cell count', () => {
      render(canvas(layout, now, drawn.context));
      const block = nodeOf('gpio_block');
      expect(block).toHaveAttribute('data-change', 'removed');
      expect(block).toHaveAttribute('data-kind', 'hier');
      expect(within(block).queryByRole('button')).toBeNull();
      expect(block.querySelector('.sd-node-subtitle')).toHaveTextContent(/^Hierarchy$/);
    });

    it('is not entered by a double click, and offers neither Expand nor Open Subsystem', () => {
      render(canvas(layout, now, drawn.context));
      fireEvent.doubleClick(screen.getByText('gpio_block', { selector: '.sd-node-name' }));
      expect(handlers.onEnterHierarchy).not.toHaveBeenCalled();
      fireEvent.contextMenu(screen.getByText('gpio_block', { selector: '.sd-node-name' }));
      expect(screen.queryByRole('menuitem', { name: 'Open Subsystem' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Expand In-Place' })).toBeNull();
    });

    it('is selected by a click like any block', () => {
      render(canvas(layout, now, drawn.context));
      fireEvent.click(screen.getByText('gpio_block', { selector: '.sd-node-name' }));
      expect(handlers.onSelect).toHaveBeenCalledWith({ kind: 'instance', id: '/gpio_block' });
    });
  });
});

describe('the ghost wire', () => {
  const drawn = (data: Partial<DiagramFlowEdge['data']>, selected = false) => {
    const props = {
      id: 'e',
      selected,
      data: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        netId: 'ghost:/::n',
        category: 'aximm',
        isInterface: true,
        ...data,
      },
    };
    const { container } = render(
      <svg>
        <ElkEdge {...(props as unknown as React.ComponentProps<typeof ElkEdge>)} />
      </svg>
    );
    return container.querySelector('path.react-flow__edge-path') as SVGPathElement;
  };

  it('is dashed in the removed color, and only dashed once it is selected', () => {
    const wire = drawn({ changeRemoved: true });
    expect(wire.style.stroke).toBe('var(--sd-change-removed)');
    expect(wire.style.strokeDasharray).toBe('6 4');
    expect(wire).toHaveClass('sd-edge-removed');
    const selected = drawn({ changeRemoved: true }, true);
    expect(selected.style.stroke).not.toBe('var(--sd-change-removed)');
    expect(selected.style.strokeDasharray).toBe('6 4');
  });

  it('is an ordinary wire without the mark', () => {
    const wire = drawn({});
    expect(wire.style.strokeDasharray).toBe('');
    expect(wire).not.toHaveClass('sd-edge-removed');
  });
});

describe('NodeHeader of a ghost', () => {
  it('has the sign and, for a hierarchy, no expand toggle', () => {
    const instance = { name: 'blk', path: '/blk', kind: 'hier', parent: '/' } as never;
    render(
      <NodeHeader
        instance={instance}
        cellCount={0}
        expanded={false}
        change={{ status: 'removed', title: 'Removed: only in the base' }}
      />
    );
    expect(screen.getByRole('img', { name: 'Removed: only in the base' })).toHaveTextContent('−');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('legend, toolbar and outline of the ghosts', () => {
  const legend = (changes: React.ComponentProps<typeof DiagramLegend>['changes']) =>
    render(
      <ReactFlowProvider>
        <DiagramLegend edges={[]} nodes={[]} review={false} changes={changes} />
      </ReactFlowProvider>
    );

  it('names the removed kind with a swatch while the ghosts are drawn, and then has no count to open', () => {
    legend({ kinds: ['removed'], newWire: false, removedWire: true, removed: 4 });
    const panel = screen.getByLabelText('Legend');
    expect(panel).toHaveTextContent('− Removed');
    expect(panel.querySelector('.sd-legend-swatch')).toHaveAttribute('data-change', 'removed');
    expect(panel).toHaveTextContent('Removed wire');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps the count that opens the Changes tab while nothing is drawn', () => {
    legend({ kinds: [], newWire: false, removed: 4 });
    expect(screen.getByRole('button', { name: '− 4 removed, see Changes' })).toBeVisible();
  });

  it('has a Removed toggle only when asked, which says what it does', () => {
    const base = {
      compare: compareOf(zynqDiff()),
      onStart: jest.fn(),
      onStop: jest.fn(),
      onOpenChanges: jest.fn(),
      marksOn: true,
      onMarksChange: jest.fn(),
    };
    const { rerender } = render(<CompareControl {...base} />);
    expect(screen.queryByRole('button', { name: 'Show removed' })).toBeNull();
    const onChange = jest.fn();
    rerender(<CompareControl {...base} removed={{ on: true, onChange }} />);
    const toggle = screen.getByRole('button', { name: 'Show removed' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('lists a ghost block and port in the outline with the minus sign', () => {
    const { union, marks } = comparison(zynqBase, zynqNow);
    render(
      <OutlineTree
        graph={union.graph}
        levelPath="/"
        selection={null}
        searchMatches={null}
        review={null}
        clocks={null}
        changes={marks}
        onSelect={jest.fn()}
      />
    );
    const block = screen.getByRole('button', { name: /^axi_gpio_0/ });
    expect(within(block).getByRole('img', { name: /^Removed/ })).toHaveTextContent('−');
    expect(
      within(screen.getByRole('button', { name: /^led_o/ })).getByRole('img', { name: /^Removed/ })
    ).toHaveTextContent('−');
  });
});

describe('the outline of a removed hierarchy', () => {
  it('lists it as one row with the minus sign, without a chevron or a count of cells', () => {
    const { union, marks } = comparison(systemBd(), systemBd(withoutGpioBlock));
    render(
      <OutlineTree
        graph={union.graph}
        levelPath="/"
        selection={null}
        searchMatches={null}
        review={null}
        clocks={null}
        changes={marks}
        onSelect={jest.fn()}
      />
    );
    const row = screen.getByRole('button', { name: /^gpio_block/ });
    expect(within(row).getByRole('img', { name: /^Removed/ })).toHaveTextContent('−');
    expect(screen.queryByRole('button', { name: 'Collapse gpio_block' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Expand gpio_block' })).toBeNull();
    expect(row.textContent).not.toMatch(/\d$/);
  });
});

describe('Details of a ghost', () => {
  const { union, marks, diff, now } = comparison(zynqBase, zynqNow);
  const details = (selection: Parameters<typeof DetailsPanel>[0]['selection']) => {
    const onSelect = jest.fn();
    render(
      <DetailsPanel
        graph={union.graph}
        clocks={analyzeClocks(now)}
        selection={selection}
        selectedNodeIds={[]}
        focusedPin={null}
        comparison={{ marks, rows: changeRows(diff, { ignoreVersionOnly: false }) }}
        onSelect={onSelect}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
    return onSelect;
  };

  it('says it is only in the base, with its type and parameters from the base, and offers nothing to open', () => {
    details({ kind: 'instance', id: '/axi_gpio_0' });
    expect(screen.getByRole('heading', { name: 'axi_gpio_0' })).toBeVisible();
    expect(screen.getByText('Only in the base')).toBeVisible();
    expect(screen.getByText(/xilinx\.com:ip:axi_gpio:2\.0/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Parameters' })).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Created at/)).toBeNull();
  });

  it('describes a ghost port and a ghost wire, whose pins can be selected', () => {
    details({ kind: 'boundary', id: '/::led_o' });
    expect(screen.getByRole('heading', { name: 'led_o' })).toBeVisible();
    expect(screen.getByText('Only in the base')).toBeVisible();
  });

  it('lists the pins of a ghost wire and selects one', () => {
    const onSelect = details({ kind: 'net', id: 'ghost:/::periph_gpio0' });
    expect(screen.getByText('Only in the base')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '/axi_gpio_0/S_AXI' }));
    expect(onSelect).toHaveBeenCalledWith({ kind: 'instance', id: '/axi_gpio_0' });
  });

  it('does not count the ghosts among the instances and nets of the design', () => {
    details(null);
    const counts = screen.getAllByRole('definition');
    expect(counts.map((d) => d.textContent)).toContain(String(Object.keys(now.instances).length));
    expect(counts.map((d) => d.textContent)).toContain(String(now.nets.length));
  });

  it('marks the pin a block lost, in the Pins of the block', () => {
    details({ kind: 'instance', id: '/axi_periph' });
    const row = screen.getAllByText('M00_AXI')[0].closest('tr')!;
    expect(within(row).getByRole('img', { name: 'Only in the base' })).toHaveTextContent('−');
  });
});

describe('Details of a pin whose wire is only in the base', () => {
  // The wire is gone from the design, both of its ends stay: it is a ghost between two pins that are unconnected now.
  const lostWire = (net: string) => {
    const [base, now] = [systemBd(), systemBd((d: any) => delete d.interface_nets[net])];
    return { now, shown: comparison(base, now) };
  };

  function details(
    { now, shown }: ReturnType<typeof lostWire>,
    graph: SystemGraph,
    selection: Parameters<typeof DetailsPanel>[0]['selection']
  ) {
    return render(
      <DetailsPanel
        graph={graph}
        clocks={analyzeClocks(now)}
        selection={selection}
        selectedNodeIds={[]}
        focusedPin={null}
        comparison={{ marks: shown.marks, rows: shown.rows }}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
  }
  // The row of the Pins table: the Changes table has rows about the pin too.
  const pinRow = (name: string) =>
    screen
      .getAllByText(name, { selector: 'td' })
      .map((cell) => cell.closest('tr')!)
      .find((row) => row.cells.length === 3)!;
  const unconnected = /^Unconnected: no net drives this pin/;
  const note = /ties an input without a driver/;

  it('keeps the pin undriven, as the open design has it, and lists the ghost wire apart with the minus sign', () => {
    const lost = lostWire('periph_block');
    const open = details(lost, lost.now, { kind: 'instance', id: '/gpio_block' });
    expect(within(pinRow('S_AXI')).getByTitle(unconnected)).toBeVisible();
    expect(screen.getByText(note)).toBeVisible();
    open.unmount();
    details(lost, lost.shown.union.graph, { kind: 'instance', id: '/gpio_block' });
    expect(within(pinRow('S_AXI')).getByTitle(unconnected)).toBeVisible();
    expect(screen.getByText(note)).toBeVisible();
    const ghost = within(pinRow('S_AXI')).getByRole('button', { name: /periph_block/ });
    expect(ghost).toHaveAttribute('title', 'Only in the base');
    expect(ghost).toHaveTextContent('−');
  });

  it('keeps the unconnected note of a port that lost its wire', () => {
    const lost = lostWire('ps_ddr');
    const open = details(lost, lost.now, { kind: 'boundary', id: '/::DDR' });
    expect(screen.getByText(/on this level/)).toBeVisible();
    open.unmount();
    details(lost, lost.shown.union.graph, { kind: 'boundary', id: '/::DDR' });
    expect(screen.getByText(/on this level/)).toBeVisible();
  });
});

describe('the undriven note of a block with a ghost sink pin', () => {
  it('is not raised by a pin that only the base has, and still is by a pin of the design', () => {
    const [base, raw] = [zynqBase, zynqNow];
    // `axi_periph` lists every pin; the pin it lost is an input in the base.
    const complete = (graph: SystemGraph): SystemGraph => ({
      ...graph,
      instances: {
        ...graph.instances,
        '/axi_periph': { ...graph.instances['/axi_periph'], pinsComplete: true },
      },
    });
    const now = complete(raw);
    const diff = diffSystemGraphs(base, now);
    const additions = unionAdditions(base, now, diff);
    const asSink = {
      ...additions,
      pins: additions.pins.map((p) => ({ ...p, pin: { ...p.pin, direction: 'in' as const } })),
    };
    const union = withUnion(now, asSink);
    expect(union.ghosts.pins.get('/axi_periph')).toEqual(new Set(['M00_AXI']));
    const note = /ties an input without a driver/;
    const details = (graph: SystemGraph, comparisonOf?: ReturnType<typeof buildChangeMarks>) =>
      render(
        <DetailsPanel
          graph={graph}
          clocks={analyzeClocks(now)}
          selection={{ kind: 'instance', id: '/axi_periph' }}
          selectedNodeIds={[]}
          focusedPin={null}
          comparison={
            comparisonOf && {
              marks: comparisonOf,
              rows: changeRows(diff, { ignoreVersionOnly: false }),
            }
          }
          onSelect={jest.fn()}
          onEnterHierarchy={jest.fn()}
          onReveal={jest.fn()}
          onOpenDefinition={jest.fn()}
        />
      );
    const open = details(now);
    const openNote = screen.queryByText(note) !== null;
    open.unmount();
    details(union.graph, buildChangeMarks(diff, now, union.ghosts));
    expect(screen.queryByText(note) !== null).toBe(openNote);
  });
});

describe('a ghost hierarchy is not entered or expanded by the navigation', () => {
  it('refuses its path, and still enters and expands a hierarchy of the design', () => {
    const { union } = comparison(systemBd(), systemBd(withoutGpioBlock));
    const { result } = renderHook(() => useDiagramNavigation(union.graph, union.ghosts));
    act(() => result.current.enterHierarchy('/gpio_block'));
    act(() => result.current.toggleExpanded('/gpio_block'));
    expect(result.current.levelPath).toBe('/');
    expect(result.current.expanded.size).toBe(0);
    const plain = renderHook(() => useDiagramNavigation(systemBd()));
    act(() => plain.result.current.enterHierarchy('/gpio_block'));
    expect(plain.result.current.levelPath).toBe('/gpio_block');
  });
});

describe('the cell count of a hierarchy with a ghost', () => {
  it('leaves the ghost out in the outline', () => {
    const [base, now] = [systemBd(), systemBd(withoutNestedSlave)];
    const { union, marks } = comparison(base, now);
    expect(union.graph.levels['/gpio_block'].instances).toHaveLength(
      1 + now.levels['/gpio_block'].instances.length
    );
    render(
      <OutlineTree
        graph={union.graph}
        levelPath="/"
        selection={null}
        searchMatches={null}
        review={null}
        clocks={null}
        changes={marks}
        onSelect={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /^gpio_block/ }).textContent).toMatch(
      new RegExp(`${now.levels['/gpio_block'].instances.length}$`)
    );
  });
});

describe('the style of the ghosts', () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, '../../../../webview/systemDiagram/systemDiagram.css'),
    'utf8'
  );
  const rule = (selector: string) =>
    new RegExp(`${selector.replace(/[[\]()]/g, '\\$&')}[^{]*\\{[^}]*\\}`).exec(css)?.[0] ?? '';

  it('draws a ghost block dashed, its name struck through, in the removed color', () => {
    expect(rule(".sd-node[data-change='removed']:not([data-selected='true'])")).toContain(
      'border-style: dashed'
    );
    expect(rule(".sd-node[data-change='removed'] .sd-node-name")).toContain(
      'text-decoration: line-through'
    );
    expect(css).toMatch(
      /\.sd-node\[data-change='removed'\],\s*\.sd-frame\[data-change='removed'\]\s*\{\s*--sd-change-color: var\(--sd-change-removed\)/
    );
    expect(rule(".sd-change-sign[data-change='removed']")).toContain('var(--sd-change-removed)');
  });

  it('draws a ghost port dashed and a ghost pin struck through', () => {
    expect(css).toMatch(
      /\.sd-port\[data-change='removed'\][^{]*\s*\.sd-port-shape\s*\{[^}]*stroke-dasharray/
    );
    expect(rule(".sd-pin-label[data-change='removed']")).toContain('line-through');
  });
});
