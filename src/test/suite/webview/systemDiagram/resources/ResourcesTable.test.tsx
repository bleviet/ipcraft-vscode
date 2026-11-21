import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import type { ResourceReport } from '../../../../../domain/resourceUsage';
import type {
  DiagramResources,
  ResourceSourceOption,
} from '../../../../../shared/messages/systemDiagram';
import { ResourcesTable } from '../../../../../webview/systemDiagram/resources/ResourcesTable';
import { resourceRows } from '../../../../../webview/systemDiagram/resources/resourceRows';
import type { ResourceChannel } from '../../../../../webview/systemDiagram/resources/useResourceChannel';
import {
  compileSearch,
  DEFAULT_SEARCH_OPTIONS,
} from '../../../../../webview/systemDiagram/searchMatcher';
import { vivadoGraph, vivadoReport } from './resourceReports';

const source = (extra: Partial<ResourceSourceOption> = {}): ResourceSourceOption => ({
  id: 'impl',
  label: 'Post-route (impl_1)',
  vendor: 'vivado',
  stage: 'routed',
  origin: 'project',
  fileName: 'sys.runs/impl_1/routed_hier.rpt',
  usable: true,
  date: 'Fri Nov 21 2025',
  ...extra,
});

const resources = (extra: Partial<DiagramResources> = {}): DiagramResources => ({
  sources: [source()],
  selected: 'impl',
  report: vivadoReport,
  searched: ['sys.runs/impl_1', 'sys.runs/synth_1'],
  hierarchicalTcl: 'report_utilization -hierarchical -file util.rpt',
  ...extra,
});

function channel(overrides: Partial<ResourceChannel> = {}): ResourceChannel {
  return {
    resources: undefined,
    showToken: 0,
    load: jest.fn(),
    select: jest.fn(),
    attach: jest.fn(),
    chooseFolder: jest.fn(),
    remove: jest.fn(),
    chooseRoot: jest.fn(),
    extract: jest.fn(),
    compare: jest.fn(),
    ...overrides,
  };
}

function renderTable(
  value: DiagramResources | undefined,
  options: {
    channel?: ResourceChannel;
    report?: ResourceReport;
    filter?: string;
    onSelectInstance?: (path: string) => void;
  } = {}
) {
  const report = options.report ?? value?.report;
  return render(
    <ResourcesTable
      resources={value}
      rows={report ? resourceRows(report, vivadoGraph, value?.compare?.report) : []}
      channel={options.channel ?? channel()}
      filter={compileSearch(options.filter ?? '', DEFAULT_SEARCH_OPTIONS)}
      selection={null}
      onSelectInstance={options.onSelectInstance ?? jest.fn()}
    />
  );
}

const bodyRows = () => screen.getAllByRole('row').slice(1);
const firstColumn = () => bodyRows().map((row) => within(row).getAllByRole('cell')[0].textContent);

describe('ResourcesTable source picker', () => {
  it('lists the sources with their date, and an unusable one marked, with its reason', () => {
    const value = resources({
      sources: [
        source(),
        source({
          id: 'flat',
          label: 'Post-synthesis (flat)',
          usable: false,
          reason: 'A flat report has no per-block rows',
          date: undefined,
        }),
      ],
    });
    renderTable(value);
    const options = within(screen.getByLabelText('Report')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Post-route (impl_1) · Fri Nov 21 2025',
      'Post-synthesis (flat) (not usable)',
    ]);
    expect(options[0]).not.toBeDisabled();
    expect(options[1]).not.toBeDisabled();
    expect(options[1]).toHaveAttribute('title', 'A flat report has no per-block rows');
  });

  it('selects an unusable source too, so that the notice says why', () => {
    const ch = channel();
    renderTable(resources({ sources: [source(), source({ id: 'bad', usable: false })] }), {
      channel: ch,
    });
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'bad' } });
    expect(ch.select).toHaveBeenCalledWith('bad');
  });

  it('selects another source', () => {
    const ch = channel();
    renderTable(
      resources({ sources: [source(), source({ id: 'synth', label: 'Post-synthesis' })] }),
      { channel: ch }
    );
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'synth' } });
    expect(ch.select).toHaveBeenCalledWith('synth');
  });

  it('offers Remove only for an attached source', () => {
    const ch = channel();
    const { unmount } = renderTable(resources(), { channel: ch });
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    unmount();
    renderTable(resources({ sources: [source({ origin: 'attached', fileName: 'util.rpt' })] }), {
      channel: ch,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(ch.remove).toHaveBeenCalledWith('impl');
  });

  it('offers Remove for an attached source that is not usable, once it is selected', () => {
    const ch = channel();
    renderTable(
      resources({
        sources: [source(), source({ id: 'old', origin: 'attached', usable: false })],
        selected: 'old',
        report: undefined,
        notice: { kind: 'refused', message: 'Not a utilization report' },
      }),
      { channel: ch }
    );
    expect(screen.getByText('Not a utilization report')).toHaveAttribute('data-tone', 'warning');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(ch.remove).toHaveBeenCalledWith('old');
  });

  it('has the attach actions', () => {
    const ch = channel();
    renderTable(resources(), { channel: ch });
    fireEvent.click(screen.getByRole('button', { name: 'Attach Report...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Folder...' }));
    expect(ch.attach).toHaveBeenCalledTimes(1);
    expect(ch.chooseFolder).toHaveBeenCalledTimes(1);
  });

  it('shows the design instance select only when the report has several candidates', () => {
    const ch = channel();
    const { unmount } = renderTable(resources(), { channel: ch });
    expect(screen.queryByLabelText('Design instance in the report')).toBeNull();
    unmount();
    const report = { ...vivadoReport, rootCandidates: ['a/sys', 'b/sys'], root: 'a/sys' };
    renderTable(resources({ report }), { channel: ch });
    const select = screen.getByLabelText('Design instance in the report');
    expect(select).toHaveValue('a/sys');
    fireEvent.change(select, { target: { value: 'b/sys' } });
    expect(ch.chooseRoot).toHaveBeenCalledWith('b/sys');
  });

  it('shows the notice above the table, as a warning when it is a refusal', () => {
    renderTable(
      resources({ notice: { kind: 'rootMissing', message: 'The design is not in the report' } })
    );
    expect(screen.getByText('The design is not in the report')).toHaveAttribute(
      'data-tone',
      'warning'
    );
  });
});

describe('ResourcesTable extraction and comparison', () => {
  const checkpoint = (extra: Partial<ResourceSourceOption> = {}) =>
    source({
      id: 'ck',
      label: 'Post-route (impl_1)',
      usable: false,
      extractable: true,
      reason: 'Extract the report from the checkpoint.',
      date: undefined,
      ...extra,
    });

  it('labels a checkpoint as such instead of not usable, and shows Extract for the selected one', () => {
    const ch = channel();
    renderTable(
      resources({ sources: [source(), checkpoint()], selected: 'ck', report: undefined }),
      { channel: ch }
    );
    const options = within(screen.getByLabelText('Report')).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Post-route (impl_1) · Fri Nov 21 2025',
      'Post-route (impl_1) (checkpoint)',
    ]);
    expect(screen.queryByText(/not usable/)).toBeNull();
    expect(screen.getByText('Extract the report from the checkpoint.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(ch.extract).toHaveBeenCalledWith('ck');
  });

  it('has no Extract button for a source that is not a checkpoint', () => {
    renderTable(resources());
    expect(screen.queryByRole('button', { name: /^Extract/ })).toBeNull();
  });

  it('disables Extract with a spinner while that source is being extracted', () => {
    renderTable(
      resources({
        sources: [source(), checkpoint()],
        selected: 'ck',
        report: undefined,
        extracting: 'ck',
      })
    );
    const button = screen.getByRole('button', { name: 'Extract' });
    expect(button).toBeDisabled();
    expect(button.querySelector('.codicon-loading.codicon-modifier-spin')).not.toBeNull();
  });

  it('disables every Extract button while any extraction runs, with the spinner only on its own', () => {
    renderTable(
      resources({
        sources: [source(), checkpoint()],
        selected: 'ck',
        report: undefined,
        extracting: 'other',
      })
    );
    const button = screen.getByRole('button', { name: 'Extract' });
    expect(button).toBeDisabled();
    expect(button.querySelector('.codicon-loading')).toBeNull();
  });

  it('extracts the missing IPs of the OOC group, which is a usable source', () => {
    const ch = channel();
    renderTable(
      resources({
        sources: [
          source({
            id: 'ooc',
            label: 'Per-IP OOC (4 of 5 IPs)',
            stage: 'ooc',
            extractable: true,
            missing: 1,
          }),
        ],
        selected: 'ooc',
      }),
      { channel: ch }
    );
    expect(screen.queryByText(/Extract the report/)).toBeNull();
    // A usable source is not a checkpoint in the select.
    expect(
      within(screen.getByLabelText('Report'))
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Per-IP OOC (4 of 5 IPs) · Fri Nov 21 2025']);
    fireEvent.click(screen.getByRole('button', { name: 'Extract missing IPs (1)' }));
    expect(ch.extract).toHaveBeenCalledWith('ooc');
  });

  it('offers Extract for each checkpoint in the empty state', () => {
    const ch = channel();
    renderTable(resources({ sources: [checkpoint()], selected: undefined, report: undefined }), {
      channel: ch,
    });
    expect(screen.getByText('No resource report found for this design.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(ch.extract).toHaveBeenCalledWith('ck');
  });

  it('lists the other usable sources and None in the Compare with select', () => {
    const ch = channel();
    renderTable(
      resources({
        sources: [
          source(),
          source({ id: 'synth', label: 'Post-synthesis (synth_1)', stage: 'synth' }),
          checkpoint(),
          source({ id: 'bad', usable: false }),
        ],
      }),
      { channel: ch }
    );
    const select = screen.getByLabelText('Compare with');
    expect(select).toHaveValue('');
    // Both pickers carry a visible label, not only an accessible name.
    expect(screen.getByLabelText('Report').closest('label')).toHaveTextContent(/^Report/);
    expect(select.closest('label')).toHaveTextContent(/^Compare with/);
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['None', 'Post-synthesis (synth_1) · Fri Nov 21 2025']);
    fireEvent.change(select, { target: { value: 'synth' } });
    expect(ch.compare).toHaveBeenCalledWith('synth');
  });

  it('shows the compared source as chosen and clears it with None', () => {
    const ch = channel();
    renderTable(
      resources({
        sources: [source(), source({ id: 'synth', label: 'Post-synthesis' })],
        compare: { id: 'synth', report: vivadoReport },
      }),
      { channel: ch }
    );
    const select = screen.getByLabelText('Compare with');
    expect(select).toHaveValue('synth');
    fireEvent.change(select, { target: { value: '' } });
    expect(ch.compare).toHaveBeenCalledWith(undefined);
  });

  it('has no Compare with select when there is no other usable source', () => {
    renderTable(resources());
    expect(screen.queryByLabelText('Compare with')).toBeNull();
  });
});

describe('ResourcesTable empty state', () => {
  it('says there is no report, with the actions, the searched folders and the Tcl line', () => {
    const ch = channel();
    renderTable(resources({ sources: [], selected: undefined, report: undefined }), {
      channel: ch,
    });
    expect(screen.getByText('No resource report found for this design.')).toBeVisible();
    expect(screen.getByText('Searched:')).toBeVisible();
    expect(screen.getByText('sys.runs/impl_1')).toBeVisible();
    expect(
      screen.getByText(
        'To get a report per block from Vivado, add this line after opening the run:'
      )
    ).toBeVisible();
    const tcl = screen.getByText('report_utilization -hierarchical -file util.rpt');
    expect(tcl.tagName).toBe('CODE');
    expect(screen.queryByLabelText('Report')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Attach Report...' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose Folder...' }));
    expect(ch.attach).toHaveBeenCalledTimes(1);
    expect(ch.chooseFolder).toHaveBeenCalledTimes(1);
  });

  it('lists a source that cannot be used with its reason, and the notice', () => {
    renderTable(
      resources({
        sources: [source({ usable: false, reason: 'Not a utilization report' })],
        report: undefined,
        notice: { kind: 'refused', message: 'Refused: not a utilization report' },
      })
    );
    expect(screen.getByText('No resource report found for this design.')).toBeVisible();
    expect(screen.getByText(/: Not a utilization report/)).toBeVisible();
    expect(screen.getByText('Refused: not a utilization report')).toHaveAttribute(
      'data-tone',
      'warning'
    );
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
  });

  it('gives each attached source that cannot be used its own Remove button', () => {
    const ch = channel();
    renderTable(
      resources({
        sources: [
          source({ id: 'a', fileName: 'util_a.rpt', origin: 'attached', usable: false }),
          source({ id: 'b', fileName: 'util_b.rpt', origin: 'project', usable: false }),
          source({ id: 'c', fileName: 'util_c.rpt', origin: 'attached', usable: false }),
        ],
        report: undefined,
      }),
      { channel: ch }
    );
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Remove util_c.rpt' }));
    expect(ch.remove).toHaveBeenCalledWith('c');
  });

  it('says it is looking for reports until the extension has answered', () => {
    renderTable(undefined);
    expect(screen.getByText('Looking for reports...')).toBeVisible();
    expect(screen.queryByText('No resource report found for this design.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Attach Report...' })).toBeNull();
  });
});

describe('ResourcesTable rows', () => {
  it('has the columns, and the design row last in bold', () => {
    renderTable(resources());
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Block',
      'Level',
      'LUTs',
      'FFs',
      'BRAM',
      'DSPs',
      '% of design',
    ]);
    const last = bodyRows().at(-1)!;
    expect(last).toHaveTextContent(/^sys/);
    expect(last).toHaveClass('font-semibold');
    expect(last).toHaveTextContent('841');
    expect(last).toHaveTextContent('100.0 %');
  });

  it('labels what the tool generated and what is outside the design', () => {
    const report: ResourceReport = {
      ...vivadoReport,
      others: [
        {
          level: '/',
          name: 'mm_interconnect_0',
          usage: { total: [10, 0, 0, 0, 0, 0, 0] },
        },
      ],
      outside: [3, 0, 0, 0, 0, 0, 0],
    };
    renderTable(resources({ report }));
    expect(firstColumn()).toContain('mm_interconnect_0 (not a block of the diagram)');
    expect(firstColumn()).toContain('Outside the design');
  });

  it('sorts by a column header and marks it with aria-sort', () => {
    renderTable(resources());
    const lutHeader = screen.getByRole('columnheader', { name: 'LUTs' });
    expect(lutHeader).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(within(lutHeader).getByRole('button'));
    expect(lutHeader).toHaveAttribute('aria-sort', 'descending');
    expect(firstColumn().slice(0, 2)).toEqual(['smartconnect_0', 'axi_bram_ctrl_0']);
    expect(firstColumn().at(-1)).toBe('sys');
    fireEvent.click(within(lutHeader).getByRole('button'));
    expect(lutHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(firstColumn()[0]).toBe('bram_0');
    const blockHeader = screen.getByRole('columnheader', { name: 'Block' });
    fireEvent.click(within(blockHeader).getByRole('button'));
    expect(blockHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(lutHeader).toHaveAttribute('aria-sort', 'none');
    expect(firstColumn()[0]).toBe('axi_bram_ctrl_0');
  });

  it('filters the rows', () => {
    renderTable(resources(), { filter: 'gpio' });
    expect(firstColumn()).toEqual(['axi_gpio_0', 'axi_gpio_1']);
  });

  it('goes to the block of a clicked row, and does nothing for the other rows', () => {
    const onSelectInstance = jest.fn();
    renderTable(resources(), { onSelectInstance });
    fireEvent.click(screen.getByText('smartconnect_0'));
    expect(onSelectInstance).toHaveBeenCalledWith('/smartconnect_0');
    fireEvent.click(screen.getByText('sys'));
    expect(onSelectInstance).toHaveBeenCalledTimes(1);
  });

  it('marks the sum of an out-of-context hierarchy', () => {
    const summed: ResourceReport = {
      ...vivadoReport,
      instances: {
        ...vivadoReport.instances,
        '/hier_0': { total: [5, 6, 2, 0, 0, 0, 0], summed: true },
      },
    };
    renderTable(resources({ report: summed }));
    const row = screen.getByText('hier_0').closest('tr')!;
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('Σ 5');
  });
});

describe('ResourcesTable metric cells', () => {
  const cells = (name: string) =>
    within(screen.getByText(name).closest('tr')!)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

  it('shows each count with its share of the device, the design row included', () => {
    renderTable(resources());
    expect(cells('smartconnect_0').slice(2, 6)).toEqual([
      '422 (0.7 %)',
      '449 (0.4 %)',
      '0 (0 %)',
      '0 (0 %)',
    ]);
    expect(cells('bram_0').slice(2, 6)).toEqual([
      '4 (< 0.1 %)',
      '5 (< 0.1 %)',
      '2 (1.5 %)',
      '0 (0 %)',
    ]);
    expect(cells('sys').slice(2, 6)).toEqual([
      '841 (1.3 %)',
      '1386 (1.1 %)',
      '2 (1.5 %)',
      '0 (0 %)',
    ]);
    // The share of the design keeps its column.
    expect(cells('smartconnect_0')[6]).toBe('50.2 %');
  });

  it('has no Show or Color by select', () => {
    renderTable(resources());
    expect(screen.queryByRole('combobox', { name: 'Show' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Color by' })).not.toBeInTheDocument();
  });

  it('shows a sigma and the bare count for a summed row, which has no device share', () => {
    const summed: ResourceReport = {
      ...vivadoReport,
      instances: {
        ...vivadoReport.instances,
        '/hier_0': { total: [5, 6, 2, 0, 0, 0, 0], summed: true },
      },
    };
    renderTable(resources({ report: summed }));
    expect(cells('hier_0').slice(2, 6)).toEqual(['Σ 5', 'Σ 6', 'Σ 2', 'Σ 0']);
  });

  it('filters on the counts and on the shares of the device it shows', () => {
    const { unmount } = renderTable(resources(), { filter: '1.5 %' });
    expect(firstColumn()).toEqual(expect.arrayContaining(['bram_0']));
    expect(firstColumn()).not.toContain('smartconnect_0');
    unmount();
    renderTable(resources(), { filter: '422' });
    expect(firstColumn()).toEqual(['smartconnect_0']);
  });
});

describe('ResourcesTable change against the compared report', () => {
  const synth = source({ id: 'synth', label: 'Post-synthesis (synth_1)', date: undefined });
  const compared: ResourceReport = {
    ...vivadoReport,
    stage: 'synth',
    instances: {
      ...vivadoReport.instances,
      '/smartconnect_0': { total: [368, 449, 1, 0, 0, 0, 0] },
    },
    design: { total: [900, 1386, 2, 0, 0, 0, 0] },
  };
  const comparing = (extra: Partial<DiagramResources> = {}) =>
    resources({
      sources: [source(), synth],
      compare: { id: 'synth', report: compared },
      ...extra,
    });
  const cells = (name: string) =>
    within(screen.getByText(name).closest('tr')!)
      .getAllByRole('cell')
      .map((cell) => cell.textContent);

  it('shows the value and its change in each metric cell, the design row too', () => {
    renderTable(comparing());
    expect(cells('smartconnect_0').slice(2, 6)).toEqual([
      '422 (0.7 %) +54',
      '449 (0.4 %) 0',
      '0 (0 %) -1',
      '0 (0 %) 0',
    ]);
    expect(cells('sys').slice(2, 6)).toEqual([
      '841 (1.3 %) -59',
      '1386 (1.1 %) 0',
      '2 (1.5 %) 0',
      '0 (0 %) 0',
    ]);
    expect(screen.getByText('+54')).toHaveClass('opacity-70');
  });

  it('shows an em dash for a row the compared report lacks', () => {
    const { '/smartconnect_0': _gone, ...instances } = compared.instances;
    renderTable(comparing({ compare: { id: 'synth', report: { ...compared, instances } } }));
    expect(cells('smartconnect_0').slice(2, 6)).toEqual(
      Array(4).fill(expect.stringMatching(/ \u2014$/))
    );
  });

  it('explains the second number with a notice naming the compared source', () => {
    renderTable(comparing());
    expect(screen.getByText('Change against Post-synthesis (synth_1)')).toHaveClass(
      'sd-res-notice'
    );
  });

  it('renders the cells and no notice as before without a compared report', () => {
    renderTable(resources({ sources: [source(), synth] }));
    expect(cells('smartconnect_0').slice(2, 6)).toEqual([
      '422 (0.7 %)',
      '449 (0.4 %)',
      '0 (0 %)',
      '0 (0 %)',
    ]);
    expect(screen.queryByText(/Change against/)).toBeNull();
  });

  it('still sorts by value, not by change', () => {
    renderTable(comparing());
    fireEvent.click(within(screen.getByRole('columnheader', { name: 'LUTs' })).getByRole('button'));
    expect(firstColumn().slice(0, 2)).toEqual(['smartconnect_0', 'axi_bram_ctrl_0']);
  });

  it('filters on a change text', () => {
    renderTable(comparing(), { filter: '+54' });
    expect(firstColumn()).toEqual(['smartconnect_0']);
  });
});
