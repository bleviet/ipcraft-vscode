import { cleanup, render, screen, within } from '@testing-library/react';
import React from 'react';
import { ResourceDetails } from '../../../../../webview/systemDiagram/resources/ResourceDetails';
import { oocReport, quartusReport, vivadoReport } from './resourceReports';

describe('ResourceDetails', () => {
  it('lists every metric with total, self and the shares, and the stage and source', () => {
    render(<ResourceDetails report={vivadoReport} path="/axi_bram_ctrl_0" />);
    expect(screen.getByRole('heading', { name: 'Resources' })).toBeVisible();
    expect(screen.getByText('Post-route · routed_hier.rpt')).toBeVisible();
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Metric',
      'Total',
      'Self',
      '% of design',
      '% of device',
    ]);
    const luts = within(screen.getByText('LUTs').closest('tr')!).getAllByRole('cell');
    expect(luts.map((cell) => cell.textContent)).toEqual([
      'LUTs',
      '154',
      '\u2014',
      '18.3 %',
      '0.2 %',
    ]);
  });

  describe('with a compared report', () => {
    // The same design, one LUT row of the block lower in the compared stage.
    const compared = {
      ...vivadoReport,
      stage: 'synth' as const,
      source: { ...vivadoReport.source, fileName: 'synth_hier.rpt' },
      instances: {
        ...vivadoReport.instances,
        '/axi_bram_ctrl_0': {
          ...vivadoReport.instances['/axi_bram_ctrl_0'],
          total: vivadoReport.instances['/axi_bram_ctrl_0'].total.map((n, i) =>
            i === 0 ? n - 4 : n + 2
          ),
        },
      },
    };

    it('adds the compared total and the signed change, and keeps the other columns', () => {
      render(<ResourceDetails report={vivadoReport} compare={compared} path="/axi_bram_ctrl_0" />);
      expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
        'Metric',
        'Total (Post-route)',
        'Total (Post-synthesis)',
        'Change',
        'Self',
        '% of design',
        '% of device',
      ]);
      expect(screen.getByText('Compared with Post-synthesis · synth_hier.rpt')).toBeVisible();
      const luts = within(screen.getByText('LUTs').closest('tr')!).getAllByRole('cell');
      expect(luts.map((cell) => cell.textContent)).toEqual([
        'LUTs',
        '154',
        '150',
        '+4',
        '\u2014',
        '18.3 %',
        '0.2 %',
      ]);
      const registers = within(screen.getByText('FFs').closest('tr')!).getAllByRole('cell');
      expect(registers[3]).toHaveTextContent('-2');
    });

    it('writes a decrease with a minus sign and no change as 0', () => {
      render(<ResourceDetails report={compared} compare={vivadoReport} path="/axi_bram_ctrl_0" />);
      const luts = within(screen.getByText('LUTs').closest('tr')!).getAllByRole('cell');
      expect(luts[3]).toHaveTextContent('-4');
      cleanup();
      render(
        <ResourceDetails report={vivadoReport} compare={vivadoReport} path="/axi_bram_ctrl_0" />
      );
      const same = within(screen.getByText('LUTs').closest('tr')!).getAllByRole('cell');
      expect(same[3]).toHaveTextContent(/^0$/);
    });

    it('shows an em dash where the compared report has no row for the block', () => {
      const without = { ...compared, instances: {} };
      render(<ResourceDetails report={vivadoReport} compare={without} path="/axi_bram_ctrl_0" />);
      const luts = within(screen.getByText('LUTs').closest('tr')!).getAllByRole('cell');
      expect(luts[2]).toHaveTextContent('\u2014');
      expect(luts[3]).toHaveTextContent('\u2014');
    });
  });

  it('shows an em dash for a self figure the report does not give', () => {
    render(<ResourceDetails report={quartusReport} path="/ram_0" />);
    const row = within(screen.getByText('M10Ks').closest('tr')!).getAllByRole('cell');
    expect(row[2]).toHaveTextContent('—');
  });

  it('notes that an out-of-context hierarchy is a sum', () => {
    render(<ResourceDetails report={oocReport} path="/hier_0" />);
    expect(screen.getByText('Sum of the blocks inside, each built on its own')).toBeVisible();
  });

  it('says in the per-block stage that the block has no report of its own', () => {
    render(<ResourceDetails report={oocReport} path="/hier_0/axi_gpio_1" />);
    expect(
      screen.getByText(
        'No report of this block on its own: it has no build of its own, it was not synthesized out of context, or its run was an IP cache hit.'
      )
    ).toBeVisible();
  });

  it('shows no device share for the sum of the IPs inside', () => {
    render(<ResourceDetails report={oocReport} path="/hier_0" />);
    const row = within(screen.getByText('LUTs').closest('tr')!).getAllByRole('cell');
    expect(row[4]).toHaveTextContent('—');
  });

  it('explains a block that is not in the report', () => {
    render(<ResourceDetails report={quartusReport} path="/clk_0" />);
    expect(
      screen.getByText(
        'Not in the report: no logic left after optimization, or the report is for another revision of the design.'
      )
    ).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows nothing for a path the report does not know', () => {
    const { container } = render(<ResourceDetails report={vivadoReport} path="/nope" />);
    expect(container).toBeEmptyDOMElement();
  });
});
