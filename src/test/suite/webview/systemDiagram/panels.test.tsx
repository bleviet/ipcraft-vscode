import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { AddressMapTable } from '../../../../webview/systemDiagram/AddressMapTable';
import { BottomPanel } from '../../../../webview/systemDiagram/BottomPanel';
import { OutlineTree } from '../../../../webview/systemDiagram/OutlineTree';
import { InstanceDetails } from '../../../../webview/systemDiagram/InstanceDetails';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { loadFixtureGraph, loadQsysFixtureGraph } from './fixtureGraph';

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

describe('AddressMapTable ranges', () => {
  const props = { onSelectInstance: jest.fn(), onReveal: jest.fn() };

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

describe('outline and tab text', () => {
  it('lets the type detail take only leftover room so the name shrinks last', () => {
    const graph = loadFixtureGraph();
    render(
      <OutlineTree
        graph={graph}
        levelPath="/"
        selection={null}
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
    expect(screen.getByRole('tab', { name: /^Problems \d+$/ })).toBeVisible();
  });
});
