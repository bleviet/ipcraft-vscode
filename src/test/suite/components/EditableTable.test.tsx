import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { EditableTable } from '../../../webview/shared/components/EditableTable';

interface TestRow {
  name: string;
}

function EditableTableHarness({
  initialRows,
  onAddRow,
}: {
  initialRows: TestRow[];
  onAddRow: (row: TestRow) => void;
}) {
  const [rows, setRows] = useState<TestRow[]>(initialRows);
  const [isAdding, setIsAdding] = useState(false);
  const [draftName, setDraftName] = useState('');

  return (
    <EditableTable<TestRow>
      title="Rows"
      rows={rows}
      rowLabelSingular="row"
      addButtonLabel="Add Row"
      onAdd={() => {
        setDraftName('');
        setIsAdding(true);
      }}
      columns={[
        { key: 'name', header: 'Name' },
        { key: 'actions', header: 'Actions', align: 'right' },
      ]}
      editingIndex={null}
      isAdding={isAdding}
      renderDisplayRow={(row, index) => (
        <tr key={index}>
          <td>{row.name}</td>
          <td />
        </tr>
      )}
      renderEditRow={(isNew) => (
        <tr data-testid="edit-row">
          <td>
            <input
              aria-label="name-input"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
          </td>
          <td>
            <button
              onClick={() => {
                const newRow = { name: draftName || 'new-row' };
                setRows((prev) => [...prev, newRow]);
                onAddRow(newRow);
                setIsAdding(false);
              }}
            >
              {isNew ? 'Add' : 'Save'}
            </button>
            <button onClick={() => setIsAdding(false)}>Cancel</button>
          </td>
        </tr>
      )}
      emptyMessage="No rows"
    />
  );
}

describe('EditableTable', () => {
  it('renders rows', () => {
    const onAddRow = jest.fn();
    render(
      <EditableTableHarness
        initialRows={[{ name: 'row-a' }, { name: 'row-b' }]}
        onAddRow={onAddRow}
      />,
    );

    expect(screen.getByText('row-a')).toBeInTheDocument();
    expect(screen.getByText('row-b')).toBeInTheDocument();
  });

  it('shows inline add form and saves via onAdd', () => {
    const onAddRow = jest.fn();
    render(<EditableTableHarness initialRows={[]} onAddRow={onAddRow} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Row' }));
    expect(screen.getByTestId('edit-row')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('name-input'), {
      target: { value: 'row-new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAddRow).toHaveBeenCalledWith({ name: 'row-new' });
    expect(screen.getByText('row-new')).toBeInTheDocument();
  });

  it('cancels inline add form', () => {
    const onAddRow = jest.fn();
    render(<EditableTableHarness initialRows={[]} onAddRow={onAddRow} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Row' }));
    expect(screen.getByTestId('edit-row')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('edit-row')).not.toBeInTheDocument();
    expect(onAddRow).not.toHaveBeenCalled();
  });
});
