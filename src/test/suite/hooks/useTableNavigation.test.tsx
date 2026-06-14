import React, { useRef } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { type ActiveCell, useTableNavigation } from '../../../webview/hooks/useTableNavigation';

type Column = 'name' | 'offset' | 'desc';

interface HarnessProps {
  activeCell: ActiveCell<Column>;
  setActiveCell: jest.Mock;
  isActive?: boolean;
  onEdit?: jest.Mock;
  onDelete?: jest.Mock;
  onMove?: jest.Mock;
  onInsertAfter?: jest.Mock;
  onInsertBefore?: jest.Mock;
}

const DUMMY_ROW_IDS = ['row-0', 'row-1', 'row-2'];

function Harness({
  activeCell,
  setActiveCell,
  isActive = true,
  onEdit,
  onDelete,
  onMove,
  onInsertAfter,
  onInsertBefore,
}: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useTableNavigation<Column>({
    activeCell,
    setActiveCell,
    rowIds: DUMMY_ROW_IDS,
    columnOrder: ['name', 'offset', 'desc'],
    containerRef,
    onEdit,
    onDelete,
    onMove,
    onInsertAfter,
    onInsertBefore,
    isActive,
  });

  return (
    <div ref={containerRef} tabIndex={0} data-testid="container">
      <input data-testid="typing-input" />
      <table>
        <tbody>
          {DUMMY_ROW_IDS.map((rowId, index) => (
            <tr key={rowId} data-row-id={rowId}>
              <td data-col-key="name">name-{index}</td>
              <td data-col-key="offset">offset-{index}</td>
              <td data-col-key="desc">desc-{index}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

describe('useTableNavigation', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  afterAll(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('navigates vertically and horizontally with arrow keys', () => {
    const setActiveCell = jest.fn();
    const { getByTestId } = render(
      <Harness activeCell={{ rowId: 'row-1', key: 'name' }} setActiveCell={setActiveCell} />
    );

    const container = getByTestId('container');
    container.focus();

    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowRight' });

    expect(setActiveCell).toHaveBeenCalledWith({ rowId: 'row-2', key: 'name' });
    expect(setActiveCell).toHaveBeenCalledWith({ rowId: 'row-1', key: 'offset' });
  });

  it('supports edit, delete, and insert shortcuts', () => {
    const setActiveCell = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const onInsertAfter = jest.fn();
    const onInsertBefore = jest.fn();

    const { getByTestId } = render(
      <Harness
        activeCell={{ rowId: 'row-1', key: 'offset' }}
        setActiveCell={setActiveCell}
        onEdit={onEdit}
        onDelete={onDelete}
        onInsertAfter={onInsertAfter}
        onInsertBefore={onInsertBefore}
      />
    );

    const container = getByTestId('container');
    container.focus();

    fireEvent.keyDown(container, { key: 'F2' });
    fireEvent.keyDown(container, { key: 'Delete' });
    fireEvent.keyDown(container, { key: 'o' });
    fireEvent.keyDown(container, { key: 'O', shiftKey: true });

    expect(onEdit).toHaveBeenCalledWith('row-1', 'offset');
    expect(onDelete).toHaveBeenCalledWith('row-1');
    expect(onInsertAfter).toHaveBeenCalledTimes(1);
    expect(onInsertBefore).toHaveBeenCalledTimes(1);
  });

  it('supports alt-plus-vertical move and vim keys', () => {
    const setActiveCell = jest.fn();
    const onMove = jest.fn();
    const { getByTestId } = render(
      <Harness
        activeCell={{ rowId: 'row-1', key: 'desc' }}
        setActiveCell={setActiveCell}
        onMove={onMove}
      />
    );

    const container = getByTestId('container');
    container.focus();

    fireEvent.keyDown(container, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(container, { key: 'k' });

    expect(onMove).toHaveBeenCalledWith('row-1', 1);
    // Alt+Arrow keeps focus on the moved field (rowId stays stable after reorder);
    // the displaced neighbour does NOT get focus.
    expect(setActiveCell).toHaveBeenCalledWith({ rowId: 'row-1', key: 'desc' });
    // Plain vim 'k' is regular vertical navigation: move active cell up one row.
    expect(setActiveCell).toHaveBeenCalledWith({ rowId: 'row-0', key: 'desc' });
  });

  it('ignores key handling when inactive or when typing', () => {
    const setActiveCell = jest.fn();
    const { getByTestId, rerender } = render(
      <Harness
        activeCell={{ rowId: 'row-1', key: 'name' }}
        setActiveCell={setActiveCell}
        isActive={false}
      />
    );

    const container = getByTestId('container');
    container.focus();
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    expect(setActiveCell).not.toHaveBeenCalled();

    rerender(
      <Harness activeCell={{ rowId: 'row-1', key: 'name' }} setActiveCell={setActiveCell} />
    );
    const input = getByTestId('typing-input');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(setActiveCell).not.toHaveBeenCalled();
  });
});
