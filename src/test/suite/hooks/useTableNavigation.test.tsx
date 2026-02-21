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
    rowCount: 3,
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
          {[0, 1, 2].map((row) => (
            <tr key={row} data-row-idx={row}>
              <td data-col-key="name">name-{row}</td>
              <td data-col-key="offset">offset-{row}</td>
              <td data-col-key="desc">desc-{row}</td>
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
      <Harness activeCell={{ rowIndex: 1, key: 'name' }} setActiveCell={setActiveCell} />
    );

    const container = getByTestId('container');
    container.focus();

    fireEvent.keyDown(container, { key: 'ArrowDown' });
    fireEvent.keyDown(container, { key: 'ArrowRight' });

    expect(setActiveCell).toHaveBeenCalledWith({ rowIndex: 2, key: 'name' });
    expect(setActiveCell).toHaveBeenCalledWith({ rowIndex: 1, key: 'offset' });
  });

  it('supports edit, delete, and insert shortcuts', () => {
    const setActiveCell = jest.fn();
    const onEdit = jest.fn();
    const onDelete = jest.fn();
    const onInsertAfter = jest.fn();
    const onInsertBefore = jest.fn();

    const { getByTestId } = render(
      <Harness
        activeCell={{ rowIndex: 1, key: 'offset' }}
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

    expect(onEdit).toHaveBeenCalledWith(1, 'offset');
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(onInsertAfter).toHaveBeenCalledTimes(1);
    expect(onInsertBefore).toHaveBeenCalledTimes(1);
  });

  it('supports alt-plus-vertical move and vim keys', () => {
    const setActiveCell = jest.fn();
    const onMove = jest.fn();
    const { getByTestId } = render(
      <Harness
        activeCell={{ rowIndex: 1, key: 'desc' }}
        setActiveCell={setActiveCell}
        onMove={onMove}
      />
    );

    const container = getByTestId('container');
    container.focus();

    fireEvent.keyDown(container, { key: 'ArrowDown', altKey: true });
    fireEvent.keyDown(container, { key: 'k' });

    expect(onMove).toHaveBeenCalledWith(1, 1);
    expect(setActiveCell).toHaveBeenCalledWith({ rowIndex: 2, key: 'desc' });
    expect(setActiveCell).toHaveBeenCalledWith({ rowIndex: 0, key: 'desc' });
  });

  it('ignores key handling when inactive or when typing', () => {
    const setActiveCell = jest.fn();
    const { getByTestId, rerender } = render(
      <Harness
        activeCell={{ rowIndex: 1, key: 'name' }}
        setActiveCell={setActiveCell}
        isActive={false}
      />
    );

    const container = getByTestId('container');
    container.focus();
    fireEvent.keyDown(container, { key: 'ArrowDown' });
    expect(setActiveCell).not.toHaveBeenCalled();

    rerender(<Harness activeCell={{ rowIndex: 1, key: 'name' }} setActiveCell={setActiveCell} />);
    const input = getByTestId('typing-input');
    input.focus();
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(setActiveCell).not.toHaveBeenCalled();
  });
});
