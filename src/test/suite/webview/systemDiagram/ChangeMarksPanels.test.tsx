import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { changeRows } from '../../../../services/systemDiagram/diff/changeRows';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { buildChangeMarks } from '../../../../webview/systemDiagram/changeMarks';
import { DetailsPanel } from '../../../../webview/systemDiagram/DetailsPanel';
import { NodeHeader } from '../../../../webview/systemDiagram/NodeHeader';
import { OutlineTree } from '../../../../webview/systemDiagram/OutlineTree';
import type { SystemGraph, SystemInstance } from '../../../../domain/systemGraph';
import * as fs from 'fs';
import * as path from 'path';
import { readSystemDesign } from '../../../../services/systemDiagram/readSystemDesign';
import type { SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import { zynqDiff, zynqGraph } from './compareFixtures';
import { systemBd, withoutNestedSlave } from './systemBdEdit';

const [graph, diff] = [zynqGraph('current'), zynqDiff()];
const marks = buildChangeMarks(diff, graph);

function outline(changes: typeof marks | null, searchMatches: string[] | null = null) {
  return render(
    <OutlineTree
      graph={graph}
      levelPath="/"
      selection={null}
      searchMatches={searchMatches}
      review={null}
      clocks={null}
      changes={changes}
      onSelect={jest.fn()}
    />
  );
}

const row = (name: RegExp) => screen.getByRole('button', { name });

describe('outline with the marks of a comparison', () => {
  it('shows the sign of a marked block after its name, colored, with the title', () => {
    outline(marks);
    const sign = within(row(/^axis_data_fifo_0/)).getByRole('img', { name: 'Added' });
    expect(sign).toHaveTextContent('+');
    expect(sign).toHaveAttribute('data-change', 'added');
    expect(sign).toHaveAttribute('title', 'Added');
    expect(
      within(row(/^sys_ps7/)).getByRole('img', { name: 'Changed: 1 parameter' })
    ).toHaveTextContent('~');
    expect(within(row(/^axi_periph/)).queryByRole('img')).toBeNull();
  });

  it('shows the count of changes below a hierarchy like the other counts', () => {
    outline(marks);
    const hier = row(/^gpio_block/);
    const count = within(hier).getByTitle('1 change inside');
    expect(count).toHaveTextContent('~1');
    expect(count).toHaveClass('ml-auto', 'shrink-0', 'text-[11px]');
    expect(count).toHaveAttribute('role', 'img');
    expect(count).toHaveAttribute('aria-label', '1 change inside');
    // The cell count of the hierarchy follows it.
    expect(hier.textContent).toMatch(/~1 1$/);
  });

  it('shows the sign of an external port', () => {
    const base = zynqGraph('base');
    const reverse = buildChangeMarks(diffSystemGraphs(graph, base), base);
    render(
      <OutlineTree
        graph={base}
        levelPath="/"
        selection={null}
        searchMatches={null}
        review={null}
        clocks={null}
        changes={reverse}
        onSelect={jest.fn()}
      />
    );
    expect(
      within(screen.getByRole('button', { name: /^led_o/ })).getByRole('img', { name: 'Added' })
    ).toHaveTextContent('+');
  });

  it('shows the same marks in the search results', () => {
    outline(marks, ['/sys_ps7', '/gpio_block/axi_gpio_1']);
    expect(within(row(/^sys_ps7/)).getByRole('img')).toHaveTextContent('~');
    // Its address changed as well, so it is drawn as changed, not as a version only.
    expect(within(row(/^axi_gpio_1/)).getByRole('img')).toHaveTextContent('~');
    expect(within(row(/^gpio_block/)).getByTitle('1 change inside')).toBeInTheDocument();
  });

  it('is the outline as before without marks', () => {
    const { container } = outline(null);
    expect(container.querySelector('.sd-change-sign')).toBeNull();
    expect(screen.queryByTitle(/inside$/)).toBeNull();
  });
});

describe('NodeHeader marks', () => {
  const instance = {
    name: 'fifo',
    path: '/fifo',
    kind: 'ip',
    parent: '/',
  } as unknown as SystemInstance;

  it('draws the sign and the count with names, and nothing without a change', () => {
    const { container, rerender } = render(
      <NodeHeader
        instance={instance}
        cellCount={0}
        expanded={false}
        change={{ status: 'renamed', title: 'Renamed from old', inside: 3 }}
      />
    );
    expect(screen.getByRole('img', { name: 'Renamed from old' })).toHaveTextContent('→');
    expect(screen.getByRole('img', { name: '3 changes inside' })).toHaveTextContent('~ 3 inside');
    rerender(<NodeHeader instance={instance} cellCount={0} expanded={false} />);
    expect(container.querySelector('[role="img"]')).toBeNull();
  });

  it('draws only the count for a hierarchy without a status of its own', () => {
    render(
      <NodeHeader instance={instance} cellCount={0} expanded={false} change={{ inside: 1 }} />
    );
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: '1 change inside' })).toBeInTheDocument();
  });
});

describe('Details of a marked block and port', () => {
  const rows = changeRows(diff, { ignoreVersionOnly: false });

  function details(
    selection: Parameters<typeof DetailsPanel>[0]['selection'],
    g: SystemGraph = graph
  ) {
    render(
      <DetailsPanel
        graph={g}
        clocks={analyzeClocks(g)}
        selection={selection}
        selectedNodeIds={[]}
        focusedPin={null}
        comparison={{ marks, rows }}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
  }

  it('lists what changed of a block, at the top, as Change and Base to Current', () => {
    details({ kind: 'instance', id: '/sys_ps7' });
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(
      section.compareDocumentPosition(screen.getByRole('heading', { name: 'Parameters' }))
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(section).getByRole('columnheader', { name: 'Change' })).toBeVisible();
    expect(within(section).getByRole('columnheader', { name: 'Base → Current' })).toBeVisible();
    const cells = within(section).getAllByRole('row')[1].textContent;
    expect(cells).toContain('parameter CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ');
    expect(cells).toContain('100');
    expect(cells).toContain('150');
  });

  it('has the section for an added block, with its type', () => {
    details({ kind: 'instance', id: '/axis_data_fifo_0' });
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(section).toHaveTextContent('added');
  });

  it('shows the count of changes inside a hierarchy, without a second button to open it', () => {
    details({ kind: 'instance', id: '/gpio_block' });
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(section).toHaveTextContent('1 change inside');
    expect(within(section).queryByRole('table')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
    // The existing button of the Details stays.
    expect(screen.getByRole('button', { name: 'Open hierarchy' })).toBeInTheDocument();
  });

  it('has nothing for an unmarked block', () => {
    details({ kind: 'instance', id: '/axi_periph' });
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull();
  });

  it('has the section for an external port with a change', () => {
    const base = zynqGraph('base');
    const reverse = diffSystemGraphs(graph, base);
    render(
      <DetailsPanel
        graph={base}
        clocks={analyzeClocks(base)}
        selection={{ kind: 'boundary', id: '/::led_o' }}
        selectedNodeIds={[]}
        focusedPin={null}
        comparison={{
          marks: buildChangeMarks(reverse, base),
          rows: changeRows(reverse, { ignoreVersionOnly: false }),
        }}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(section).toHaveTextContent('direction out');
    expect(section).toHaveTextContent('width 7:0');
  });

  it('has no section without a comparison', () => {
    render(
      <DetailsPanel
        graph={graph}
        clocks={analyzeClocks(graph)}
        selection={{ kind: 'instance', id: '/sys_ps7' }}
        selectedNodeIds={[]}
        focusedPin={null}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
    expect(screen.queryByRole('region', { name: 'Changes' })).toBeNull();
  });
});

describe('Details of a block with an address segment change', () => {
  const nios = (side: 'base' | 'current') =>
    readSystemDesign(
      `nios_${side}.qsys`,
      'nios_system.qsys',
      fs.readFileSync(
        path.resolve(__dirname, `../../../fixtures/system-design/diff/nios_${side}.qsys`),
        'utf8'
      )
    )!;

  function detailsOf(g: SystemGraph, segmentDiff: SystemGraphDiff, id: string) {
    render(
      <DetailsPanel
        graph={g}
        clocks={analyzeClocks(g)}
        selection={{ kind: 'instance', id }}
        selectedNodeIds={[]}
        focusedPin={null}
        comparison={{
          marks: buildChangeMarks(segmentDiff, g),
          rows: changeRows(segmentDiff, { ignoreVersionOnly: false }),
        }}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
  }

  it('lists the changed segment of its slave block', () => {
    const current = nios('current');
    detailsOf(current, diffSystemGraphs(nios('base'), current), '/jtag_uart_0');
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(section).toHaveTextContent('jtag_uart_0.avalon_jtag_slave');
    expect(section).toHaveTextContent('0x00011000');
    expect(section).toHaveTextContent('0x00012000');
  });

  it('lists an added and a removed segment, the removed one found by its text', () => {
    const current = zynqGraph('current');
    const segments = [
      {
        addressSpace: 'sys_ps7/Data',
        segment: 'gpio_block/axi_gpio_1/S_AXI/Reg',
        status: 'added' as const,
        current: { offset: '0x1', range: '0x2' },
      },
      {
        addressSpace: 'sys_ps7/Data',
        segment: 'gpio_block/axi_gpio_1/S_AXI/Mem',
        status: 'removed' as const,
        base: { offset: '0x3', range: '0x4' },
      },
    ];
    detailsOf(current, { ...diff, instances: [], ports: [], segments }, '/gpio_block/axi_gpio_1');
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(section).toHaveTextContent('gpio_block/axi_gpio_1/S_AXI/Reg');
    expect(section).toHaveTextContent('gpio_block/axi_gpio_1/S_AXI/Mem');
    expect(within(section).getAllByRole('row')).toHaveLength(3);
  });

  it('lists the row of a removed segment under no block when its slave was removed', () => {
    const [base, current] = [systemBd(), systemBd(withoutNestedSlave)];
    const segmentDiff = diffSystemGraphs(base, current);
    detailsOf(current, segmentDiff, '/gpio_block');
    const section = screen.getByRole('region', { name: 'Changes' });
    expect(section).toHaveTextContent('1 change inside');
    expect(within(section).queryByRole('table')).toBeNull();
  });
});
