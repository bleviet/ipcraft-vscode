import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { AddressMapTable } from '../../../../webview/systemDiagram/AddressMapTable';
import { BottomPanel } from '../../../../webview/systemDiagram/BottomPanel';
import { OutlineTree } from '../../../../webview/systemDiagram/OutlineTree';
import { InstanceDetails } from '../../../../webview/systemDiagram/InstanceDetails';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { loadClockFixtureGraph, loadFixtureGraph, loadQsysFixtureGraph } from './fixtureGraph';

const qsys = loadQsysFixtureGraph();

describe('InstanceDetails with a pin on several nets', () => {
  it('lists every net of the pin, one link each', () => {
    const onSelect = jest.fn();
    render(
      <InstanceDetails
        graph={qsys}
        clocks={analyzeClocks(qsys)}
        instance={qsys.instances['/onchip_memory2_0']}
        onSelect={onSelect}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
    // The first match is the Pins table; the interface clocks table lists `s1` again.
    const row = screen.getAllByText('s1')[0].closest('tr')!;
    const links = within(row).getAllByRole('button');
    expect(links.map((link) => link.textContent)).toEqual([
      'nios2_gen2_0.data_master',
      'nios2_gen2_0.instruction_master',
    ]);
    fireEvent.click(links[1]);
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'net',
      id: '/::nios2_gen2_0.instruction_master',
    });
    expect(
      screen.getByText(/Platform Designer component altera_avalon_onchip_memory2 18\.1/)
    ).toBeVisible();
  });
});

describe('InstanceDetails pin provenance', () => {
  it('shows where a pin is defined next to its direction', () => {
    const graph = JSON.parse(JSON.stringify(qsys)) as typeof qsys;
    graph.instances['/pio_0'].pins.find((pin) => pin.name === 's1')!.definedBy = 'ip.yml';
    render(
      <InstanceDetails
        graph={graph}
        clocks={analyzeClocks(graph)}
        instance={graph.instances['/pio_0']}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
    const direction = (name: string) =>
      screen.getAllByText(name)[0].closest('tr')!.lastElementChild!;
    expect(direction('s1')).toHaveTextContent('slave (connection) · ip.yml');
    expect(direction('clk')).not.toHaveTextContent('·');
  });
});

describe('InstanceDetails black box', () => {
  it('states the block is not defined in the file, lists its pins, and has no hierarchy button', () => {
    const graph = JSON.parse(JSON.stringify(qsys)) as typeof qsys;
    graph.instances['/pio_0'].kind = 'blackbox';
    render(
      <InstanceDetails
        graph={graph}
        clocks={analyzeClocks(graph)}
        instance={graph.instances['/pio_0']}
        onSelect={jest.fn()}
        onEnterHierarchy={jest.fn()}
        onReveal={jest.fn()}
        onOpenDefinition={jest.fn()}
      />
    );
    expect(screen.getByText(/Black box · Not defined in this file/)).toBeVisible();
    expect(screen.getByText(/shown as a black box/)).toBeVisible();
    expect(screen.getAllByText('s1').length).toBeGreaterThan(0);
    expect(screen.queryByText('Open hierarchy')).toBeNull();
  });
});

describe('AddressMapTable ranges', () => {
  const props = { filter: null, onSelectInstance: jest.fn(), onReveal: jest.fn() };

  it('shows an unknown range as a dash for qsys', () => {
    render(<AddressMapTable graph={qsys} {...props} />);
    const row = screen.getByText('jtag_uart_0.avalon_jtag_slave').closest('tr')!;
    const cells = within(row).getAllByRole('cell');
    expect(cells[2]).toHaveTextContent('0x0001_1000');
    expect(cells[3]).toHaveTextContent('-');
    expect(screen.queryByText('auto')).toBeNull();
  });

  it('keeps auto for tool-assigned Vivado segments', () => {
    const graph = JSON.parse(JSON.stringify(loadFixtureGraph())) as ReturnType<
      typeof loadFixtureGraph
    >;
    const segment = graph.addressSegments[0];
    delete segment.range;
    render(<AddressMapTable graph={graph} {...props} />);
    const row = screen.getByText(segment.segment).closest('tr')!;
    expect(within(row).getAllByRole('cell')[3]).toHaveTextContent('auto');
  });

  it('says the design when there are no segments', () => {
    render(<AddressMapTable graph={{ ...qsys, addressSegments: [] }} {...props} />);
    expect(screen.getByText('No address segments are assigned in this design.')).toBeVisible();
  });
});

describe('bottom panel filter', () => {
  const graph = loadClockFixtureGraph();
  const design = loadFixtureGraph();
  const dataRows = () =>
    screen.queryAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);

  function Panel({ initial }: { initial: 'address' | 'clocks' }) {
    const [tab, setTab] = React.useState<React.ComponentProps<typeof BottomPanel>['tab']>(initial);
    const shown = initial === 'address' ? design : graph;
    return (
      <BottomPanel
        graph={shown}
        clocks={analyzeClocks(shown)}
        levelPath="/"
        expanded={new Set()}
        tab={tab}
        onTabChange={setTab}
        findings={[]}
        selection={null}
        focusedPin={null}
        onSelectInstance={jest.fn()}
        onSelectPin={jest.fn()}
        onSelectNet={jest.fn()}
        onReveal={jest.fn()}
      />
    );
  }
  const type = (name: string, value: string) =>
    fireEvent.change(screen.getByRole('searchbox', { name }), { target: { value } });

  it('lists only the rows of the tab on show that match, with wildcards', () => {
    render(<Panel initial="address" />);
    expect(dataRows()).toHaveLength(4);
    type('Filter Address map', 'gpio');
    expect(dataRows()).toHaveLength(1);
    expect(dataRows()[0]).toHaveTextContent('axi_gpio_0');
    type('Filter Address map', 'DMA*lite');
    expect(dataRows()).toHaveLength(1);
    // The tab counts what the design has, not what the filter leaves.
    expect(screen.getByRole('tab', { name: 'Address map 4' })).toBeVisible();
  });

  it('matches an address as written and as grouped', () => {
    render(<Panel initial="address" />);
    type('Filter Address map', '0x41200000');
    expect(dataRows()).toHaveLength(1);
    type('Filter Address map', '4120_0000');
    expect(dataRows()).toHaveLength(1);
  });

  it('says so when no row matches, and Escape clears the filter', () => {
    render(<Panel initial="address" />);
    type('Filter Address map', 'zzzz');
    expect(screen.getByText('No rows match the filter.')).toBeVisible();
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Filter Address map' }), {
      key: 'Escape',
    });
    expect(dataRows()).toHaveLength(4);
  });

  it('keeps a filter text per tab', () => {
    render(<Panel initial="clocks" />);
    const all = dataRows().length;
    type('Filter Clocks', 'zzzz');
    expect(screen.getAllByText('No rows match the filter.').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /^Resets/ }));
    expect(screen.getByRole('searchbox', { name: 'Filter Resets' })).toHaveValue('');
    expect(screen.queryByText('No rows match the filter.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /^Clocks/ }));
    expect(screen.getByRole('searchbox', { name: 'Filter Clocks' })).toHaveValue('zzzz');
    type('Filter Clocks', '');
    expect(dataRows()).toHaveLength(all);
  });
});

describe('outline while a search is on', () => {
  const graph = loadFixtureGraph();
  const renderOutline = (searchMatches: string[], onSelect = jest.fn()) =>
    render(
      <OutlineTree
        graph={graph}
        levelPath="/"
        selection={null}
        searchMatches={searchMatches}
        review={null}
        clocks={null}
        onSelect={onSelect}
      />
    );
  const row = (name: RegExp) => screen.getByRole('button', { name });

  it('lists only the matches, under their opened hierarchies', () => {
    renderOutline(['/dsp_pipeline/axis_data_fifo_0', '/dsp_pipeline/coeff_bank/config_fifo']);
    expect(screen.getByRole('heading', { name: 'Search results' })).toBeVisible();
    expect(row(/^axis_data_fifo_0/)).not.toHaveClass('opacity-60');
    expect(row(/^config_fifo/)).not.toHaveClass('opacity-60');
    expect(row(/^dsp_pipeline/)).toHaveClass('opacity-60');
    expect(row(/^coeff_bank/)).toHaveClass('opacity-60');
    expect(screen.queryByRole('button', { name: /^axi_dma_0/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^External ports/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Expand|Collapse) / })).not.toBeInTheDocument();
  });

  it('does not open a matching hierarchy without matches inside', () => {
    renderOutline(['/dsp_pipeline']);
    expect(row(/^dsp_pipeline/)).not.toHaveClass('opacity-60');
    expect(screen.queryByRole('button', { name: /^coeff_bank/ })).not.toBeInTheDocument();
  });

  it('selects a result on its level', () => {
    const onSelect = jest.fn();
    renderOutline(['/dsp_pipeline/coeff_bank/config_fifo'], onSelect);
    fireEvent.click(row(/^config_fifo/));
    expect(onSelect).toHaveBeenCalledWith(
      { kind: 'instance', id: '/dsp_pipeline/coeff_bank/config_fifo' },
      '/dsp_pipeline/coeff_bank'
    );
  });

  it('says so when nothing matches', () => {
    renderOutline([]);
    expect(screen.getByText('No matching instances')).toBeVisible();
  });
});

describe('outline and tab text', () => {
  it('lets the type detail take only leftover room so the name shrinks last', () => {
    const graph = loadFixtureGraph();
    render(
      <OutlineTree
        graph={graph}
        levelPath="/"
        selection={null}
        searchMatches={null}
        review={null}
        clocks={null}
        onSelect={jest.fn()}
      />
    );
    const row = screen.getByRole('button', { name: /^axi_dma_0/ });
    const [name, detail] = Array.from(row.querySelectorAll('span')).filter(
      (span) => !span.hasAttribute('aria-hidden')
    );
    expect(name).toHaveClass('min-w-0', 'truncate');
    expect(name).not.toHaveClass('flex-1');
    expect(detail).toHaveClass('flex-1', 'basis-0', 'min-w-0', 'truncate');
  });

  it('separates counts from labels in accessible names', () => {
    const graph = loadFixtureGraph();
    render(
      <BottomPanel
        graph={graph}
        clocks={analyzeClocks(graph)}
        levelPath="/"
        expanded={new Set()}
        tab="address"
        onTabChange={jest.fn()}
        findings={[]}
        selection={null}
        focusedPin={null}
        onSelectInstance={jest.fn()}
        onSelectPin={jest.fn()}
        onSelectNet={jest.fn()}
        onReveal={jest.fn()}
      />
    );
    expect(screen.getByRole('tab', { name: /^Address map \d+$/ })).toBeVisible();
    expect(screen.queryByRole('tab', { name: /^Problems/ })).not.toBeInTheDocument();
  });

  it('puts the Resets tab right after the Clocks tab, each counting what is in view', () => {
    const graph = loadClockFixtureGraph();
    const props = {
      graph,
      clocks: analyzeClocks(graph),
      expanded: new Set<string>(),
      tab: 'resets' as const,
      onTabChange: jest.fn(),
      findings: [],
      selection: null,
      focusedPin: null,
      onSelectInstance: jest.fn(),
      onSelectPin: jest.fn(),
      onSelectNet: jest.fn(),
      onReveal: jest.fn(),
    };
    const { rerender } = render(<BottomPanel {...props} levelPath="/" />);
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Address map 0',
      'Clocks 3',
      'Resets 3',
      'Unconnected 0',
    ]);
    expect(screen.getByRole('tab', { name: /^Resets/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Reset sources' })).toBeVisible();
    rerender(<BottomPanel {...props} levelPath="/dsp_pipeline" />);
    expect(screen.getByRole('tab', { name: 'Clocks 2' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Resets 1' })).toBeVisible();
  });
});
