import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

function paramSelection(index: number): CanvasElement {
  return { kind: 'parameter', index, id: `parameter:${index}` };
}

function baseIpCore(parameters: Record<string, unknown>[]): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
    parameters,
  } as unknown as IpCore;
}

describe('CanvasInspector ParameterPanel — GUI Placement rename/delete', () => {
  it('does not show rename/delete affordances when the parameter has no page', () => {
    const ipCore = baseIpCore([{ name: 'DATA_WIDTH', dataType: 'integer', defaultValue: 32 }]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(screen.queryByTitle(/Rename this page/)).not.toBeInTheDocument();
  });

  it('renaming a page updates uiPage for every parameter on that page, and only that page', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      { name: 'DATA_WIDTH', dataType: 'integer', defaultValue: 32, uiPage: 'Page A' },
      { name: 'ADDR_WIDTH', dataType: 'integer', defaultValue: 16, uiPage: 'Page A' },
      { name: 'OTHER', dataType: 'integer', defaultValue: 0, uiPage: 'Page B' },
    ]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const renameBtn = screen.getByTitle(/Rename this page/);
    const row = renameBtn.parentElement as HTMLElement;
    fireEvent.click(renameBtn);
    const input = within(row).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Page X' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiPage'], 'Page X');
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiPage'], 'Page X');
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 2, 'uiPage'], expect.anything());
  });

  it('deleting a page clears uiPage and uiGroup for every parameter that used it', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      {
        name: 'DATA_WIDTH',
        dataType: 'integer',
        defaultValue: 32,
        uiPage: 'Page A',
        uiGroup: 'Grp1',
      },
      { name: 'ADDR_WIDTH', dataType: 'integer', defaultValue: 16, uiPage: 'Page A' },
      { name: 'OTHER', dataType: 'integer', defaultValue: 0, uiPage: 'Page B' },
    ]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTitle(/Delete this page/));

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiPage'], null);
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], null);
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiPage'], null);
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiGroup'], null);
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 2, 'uiPage'], expect.anything());
  });

  it('renaming a group only updates parameters sharing the same page AND group', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      {
        name: 'A',
        dataType: 'integer',
        defaultValue: 0,
        uiPage: 'Page A',
        uiGroup: 'Grp1',
      },
      {
        name: 'B',
        dataType: 'integer',
        defaultValue: 0,
        uiPage: 'Page A',
        uiGroup: 'Grp1',
      },
      {
        name: 'C',
        dataType: 'integer',
        defaultValue: 0,
        uiPage: 'Page A',
        uiGroup: 'Grp2',
      },
      {
        name: 'D',
        dataType: 'integer',
        defaultValue: 0,
        uiPage: 'Page B',
        uiGroup: 'Grp1',
      },
    ]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const renameBtn = screen.getByTitle(/Rename this group/);
    const row = renameBtn.parentElement as HTMLElement;
    fireEvent.click(renameBtn);
    const input = within(row).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], 'Renamed');
    expect(onUpdate).toHaveBeenCalledWith(['parameters', 1, 'uiGroup'], 'Renamed');
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 2, 'uiGroup'], expect.anything());
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 3, 'uiGroup'], expect.anything());
  });

  it('deleting a group only clears uiGroup for parameters sharing the same page AND group', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A', uiGroup: 'Grp1' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page A', uiGroup: 'Grp2' },
      { name: 'C', dataType: 'integer', defaultValue: 0, uiPage: 'Page B', uiGroup: 'Grp1' },
    ]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTitle(/Delete this group/));

    expect(onUpdate).toHaveBeenCalledWith(['parameters', 0, 'uiGroup'], null);
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 1, 'uiGroup'], expect.anything());
    expect(onUpdate).not.toHaveBeenCalledWith(['parameters', 2, 'uiGroup'], expect.anything());
  });

  it('escape cancels an in-progress rename without calling onUpdate', () => {
    const onUpdate = jest.fn();
    const ipCore = baseIpCore([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A' },
    ]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const renameBtn = screen.getByTitle(/Rename this page/);
    const row = renameBtn.parentElement as HTMLElement;
    fireEvent.click(renameBtn);
    const input = within(row).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Page X' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('applies a page rename as a single atomic batchUpdate call when provided', () => {
    const onUpdate = jest.fn();
    const batchUpdate = jest.fn();
    const ipCore = baseIpCore([
      { name: 'A', dataType: 'integer', defaultValue: 0, uiPage: 'Page A' },
      { name: 'B', dataType: 'integer', defaultValue: 0, uiPage: 'Page A' },
    ]);
    render(
      <CanvasInspector
        selected={paramSelection(0)}
        ipCore={ipCore}
        onUpdate={onUpdate}
        batchUpdate={batchUpdate}
        onClose={jest.fn()}
      />
    );

    const renameBtn = screen.getByTitle(/Rename this page/);
    const row = renameBtn.parentElement as HTMLElement;
    fireEvent.click(renameBtn);
    const input = within(row).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Page X' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onUpdate).not.toHaveBeenCalled();
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledWith([
      [['parameters', 0, 'uiPage'], 'Page X'],
      [['parameters', 1, 'uiPage'], 'Page X'],
    ]);
  });
});
