import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RegisterEditor } from '../../../webview/components/register/RegisterEditor';
import type { BitFieldRecord } from '../../../webview/types/editor';

jest.mock('../../../webview/hooks/useDebugMode', () => ({
  useDebugMode: () => ({ debugMode: false, toggleDebugMode: jest.fn() }),
}));

function makeField(name: string, lo: number, hi = lo): BitFieldRecord {
  return {
    name,
    bits: `[${hi}:${lo}]`,
    offset: lo,
    width: hi - lo + 1,
    access: 'read-write',
    resetValue: 0,
    description: '',
  };
}

// A: [0:0], B: [7:4] (gap 1 free), C: [8:8] (gap 2 between B and C is occupied)
const INITIAL = [makeField('A', 0), makeField('B', 4, 7), makeField('C', 8)];

function Harness({
  initial,
  size = 32,
  onUpdate,
}: {
  initial: BitFieldRecord[];
  size?: number;
  onUpdate: jest.Mock;
}) {
  const [fields, setFields] = useState(initial);
  const register = { name: 'CTRL', size, fields } as unknown as Parameters<
    typeof RegisterEditor
  >[0]['register'];
  return (
    <RegisterEditor
      register={register}
      fields={fields}
      registerLayout="stacked"
      toggleRegisterLayout={jest.fn()}
      onUpdate={(path, value) => {
        onUpdate(path, value);
        if (path.length === 1 && path[0] === 'fields') {
          setFields(value as BitFieldRecord[]);
        }
      }}
    />
  );
}

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('tr[data-row-id]'));

describe('FieldsTable mouse insertion', () => {
  it('right-click offers Insert Above/Below and Insert Below adds a focused field', async () => {
    const onUpdate = jest.fn();
    const { container } = render(<Harness initial={INITIAL} onUpdate={onUpdate} />);

    fireEvent.contextMenu(rows(container)[0]);
    expect(screen.getByText('Insert Above')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Insert Below'));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const items = onUpdate.mock.calls[0][1] as BitFieldRecord[];
    expect(items).toHaveLength(4);
    expect(items[1].bits).toBe('[1:1]');
    expect(items.map((f) => f.bits).filter((_, i) => i !== 1)).toEqual(['[0:0]', '[7:4]', '[8:8]']);

    const newName = items[1].name as string;
    const input = container.querySelector<HTMLInputElement>(
      'tr[data-row-id] td[data-col-key="name"] input[value="' + newName + '"]'
    );
    expect(input).not.toBeNull();
    await waitFor(() => expect(input).toHaveFocus());
  });

  it('shows the insert error on a full register', () => {
    const onUpdate = jest.fn();
    const { container } = render(
      <Harness initial={[makeField('ALL', 0, 31)]} onUpdate={onUpdate} />
    );

    fireEvent.contextMenu(rows(container)[0]);
    fireEvent.click(screen.getByText('Insert Below'));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(container.querySelector('.vscode-error')?.textContent).toBeTruthy();
  });

  describe('hover insert bar', () => {
    let rectSpy: jest.SpyInstance;

    beforeEach(() => {
      // Rows are 48px tall starting at y=100: row i spans [100+48i, 148+48i].
      rectSpy = jest
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockImplementation(function (this: HTMLElement) {
          const idx = this.getAttribute('data-row-idx');
          const top = idx === null ? 0 : 100 + 48 * Number(idx);
          return {
            top,
            bottom: top + (idx === null ? 0 : 48),
            left: 0,
            right: 0,
            width: 0,
            height: 0,
            x: 0,
            y: top,
            toJSON: () => ({}),
          };
        });
    });

    afterEach(() => rectSpy.mockRestore());

    const hoverGap = (container: HTMLElement, gap: number) => {
      const tbody = container.querySelector('[data-fields-table="true"] tbody') as HTMLElement;
      fireEvent.mouseMove(tbody, { clientY: 100 + 48 * gap });
    };

    it('shows the (+) at a free gap and clicking it inserts once', () => {
      const onUpdate = jest.fn();
      const { container } = render(<Harness initial={INITIAL} onUpdate={onUpdate} />);

      hoverGap(container, 1);
      const button = screen.getByTitle('Insert field at position 1');
      fireEvent.click(button);

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect((onUpdate.mock.calls[0][1] as BitFieldRecord[])[1].bits).toBe('[1:1]');
    });

    it('hides the (+) at an occupied gap', () => {
      const onUpdate = jest.fn();
      const { container } = render(<Harness initial={INITIAL} onUpdate={onUpdate} />);

      hoverGap(container, 2);
      expect(screen.queryByTitle(/Insert field at position/)).toBeNull();
    });
  });
});
