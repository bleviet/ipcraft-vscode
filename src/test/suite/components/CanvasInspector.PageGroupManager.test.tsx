import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

const GENERICS_SELECTION: CanvasElement = { kind: 'generics', index: 0, id: 'generics' };

function baseIpCore(parameters: Record<string, unknown>[]): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    parameters,
  } as unknown as IpCore;
}

function renderInspector(
  parameters: Record<string, unknown>[],
  onUpdate = jest.fn(),
  batchUpdate?: jest.Mock
) {
  render(
    <CanvasInspector
      selected={GENERICS_SELECTION}
      ipCore={baseIpCore(parameters)}
      onUpdate={onUpdate}
      batchUpdate={batchUpdate}
      onClose={jest.fn()}
      onSelectElement={jest.fn()}
    />
  );
  return onUpdate;
}

/** The manager renders two `.ci-placement-manage__col`s: Pages (index 0), Groups (index 1). */
function managerColumns(): { pagesCol: HTMLElement; groupsCol: HTMLElement } {
  const manager = document.querySelector('.ci-placement-manage') as HTMLElement;
  const cols = manager.querySelectorAll<HTMLElement>('.ci-placement-manage__col');
  return { pagesCol: cols[0], groupsCol: cols[1] };
}

function rowFor(col: HTMLElement, name: string): HTMLElement {
  const row = within(col)
    .getByText(name, { selector: '.ci-placement-manage__name' })
    .closest('.ci-placement-manage__row');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe('CanvasInspector PageGroupManager', () => {
  it('lists existing pages and groups scoped to the selected page', () => {
    renderInspector([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A', uiGroup: 'Grp1' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page B' },
    ]);

    const { pagesCol, groupsCol } = managerColumns();
    expect(rowFor(pagesCol, 'Page A')).toBeInTheDocument();
    expect(rowFor(pagesCol, 'Page B')).toBeInTheDocument();
    expect(rowFor(groupsCol, 'Grp1')).toBeInTheDocument();
  });

  it('shows "no pages yet" / "no groups yet" empty states', () => {
    renderInspector([{ name: 'A', dataType: 'integer', defaultValue: 0 }]);
    expect(screen.getByText('No pages yet')).toBeInTheDocument();
    expect(screen.getByText('Create a page first')).toBeInTheDocument();
  });

  it('creating a page requires a name and at least one checked parameter', () => {
    const onUpdate = renderInspector([
      { name: 'A', dataType: 'integer', defaultValue: 0 },
      { name: 'B', dataType: 'integer', defaultValue: 0 },
    ]);
    const { pagesCol } = managerColumns();

    fireEvent.click(within(pagesCol).getByRole('button', { name: /New page/ }));
    const createBtn = within(pagesCol).getByRole('button', { name: 'Create' });
    expect(createBtn).toBeDisabled();

    const input = within(pagesCol).getByPlaceholderText('New page name…');
    fireEvent.change(input, { target: { value: 'Fresh Page' } });
    expect(createBtn).toBeDisabled(); // still no parameter checked

    fireEvent.click(within(pagesCol).getByLabelText('A'));
    expect(createBtn).not.toBeDisabled();

    fireEvent.click(createBtn);
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiPage'], 'Fresh Page');
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 1, 'uiPage'], expect.anything());
  });

  it('creating a page with multiple checked parameters batches as one atomic update', () => {
    const onUpdate = jest.fn();
    const batchUpdate = jest.fn();
    renderInspector(
      [
        { name: 'A', dataType: 'integer', defaultValue: 0 },
        { name: 'B', dataType: 'integer', defaultValue: 0 },
      ],
      onUpdate,
      batchUpdate
    );
    const { pagesCol } = managerColumns();

    fireEvent.click(within(pagesCol).getByRole('button', { name: /New page/ }));
    fireEvent.change(within(pagesCol).getByPlaceholderText('New page name…'), {
      target: { value: 'Fresh Page' },
    });
    fireEvent.click(within(pagesCol).getByLabelText('A'));
    fireEvent.click(within(pagesCol).getByLabelText('B'));
    fireEvent.click(within(pagesCol).getByRole('button', { name: 'Create' }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(batchUpdate).toHaveBeenCalledWith([
      [['parameters', 0, 'uiPage'], 'Fresh Page'],
      [['parameters', 1, 'uiPage'], 'Fresh Page'],
    ]);
  });

  it('creating a group only offers parameters already on the selected page', () => {
    const onUpdate = renderInspector([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page B' },
    ]);
    const { groupsCol } = managerColumns();

    fireEvent.click(within(groupsCol).getByRole('button', { name: /New group/ }));
    // Only A (on Page A, the default-selected groups page) should be offered.
    expect(within(groupsCol).getByLabelText('A')).toBeInTheDocument();
    expect(within(groupsCol).queryByLabelText('B')).not.toBeInTheDocument();

    fireEvent.change(within(groupsCol).getByPlaceholderText('New group name…'), {
      target: { value: 'New Grp' },
    });
    fireEvent.click(within(groupsCol).getByLabelText('A'));
    fireEvent.click(within(groupsCol).getByRole('button', { name: 'Create' }));

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], 'New Grp');
  });

  it('renaming a page from the manager updates every parameter on it', () => {
    const onUpdate = renderInspector([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page A' },
    ]);
    const { pagesCol } = managerColumns();
    const pageRow = rowFor(pagesCol, 'Page A');

    fireEvent.click(within(pageRow).getByTitle(/Rename this page/));
    const input = within(pageRow).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed Page' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiPage'], 'Renamed Page');
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiPage'], 'Renamed Page');
  });

  it('deleting a page from the manager clears uiPage and uiGroup on every parameter that used it', () => {
    const onUpdate = renderInspector([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A', uiGroup: 'G' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page B' },
    ]);
    const { pagesCol } = managerColumns();
    const pageRow = rowFor(pagesCol, 'Page A');

    fireEvent.click(within(pageRow).getByTitle(/Delete this page/));

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiPage'], null);
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], null);
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 1, 'uiPage'], expect.anything());
  });

  it('switching the groups page picker scopes the group list and rename/delete actions', () => {
    const onUpdate = renderInspector([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A', uiGroup: 'GA' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page B', uiGroup: 'GB' },
    ]);
    const { groupsCol } = managerColumns();

    const picker = within(groupsCol).getByTitle('Page these groups belong to');
    expect(rowFor(groupsCol, 'GA')).toBeInTheDocument();
    expect(
      within(groupsCol).queryByText('GB', { selector: '.ci-placement-manage__name' })
    ).toBeNull();

    fireEvent.change(picker, { target: { value: 'Page B' } });
    expect(rowFor(groupsCol, 'GB')).toBeInTheDocument();
    expect(
      within(groupsCol).queryByText('GA', { selector: '.ci-placement-manage__name' })
    ).toBeNull();

    fireEvent.click(within(groupsCol).getByTitle(/Delete this group/));
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiGroup'], null);
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], expect.anything());
  });
});
