/**
 * RegisterArrayEditor detail-view tests.
 *
 * A register-group array (nested registers) shows an editable identity strip
 * (name/offset/description) plus the selected template register's bit-field
 * detail (an embedded RegisterEditor). The template register list itself —
 * select, insert, delete, reorder, rename — lives entirely in the Outline
 * panel (every array element shares this one template), not here.
 *
 * RegisterEditor is mocked to capture its `onUpdate` (the `detailUpdate`
 * wrapper), mirroring BlockEditor.test.tsx.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

interface CapturedRegisterEditorProps {
  onUpdate?: (path: (string | number)[], value: unknown) => void;
  register?: { name?: string };
  title?: string;
  embedded?: boolean;
  headerChildren?: React.ReactNode;
}

let lastRegisterEditorProps: CapturedRegisterEditorProps | null = null;

jest.mock('../../../webview/components/register/RegisterEditor', () => ({
  RegisterEditor: React.forwardRef((props: unknown, _ref: unknown) => {
    lastRegisterEditorProps = props as CapturedRegisterEditorProps;
    return React.createElement('div', { 'data-testid': 'mock-register-editor' });
  }),
}));

import {
  RegisterArrayEditor,
  type RegisterArrayEditorProps,
} from '../../../webview/components/memorymap/RegisterArrayEditor';

const noop = jest.fn();

function makeArray(
  regs: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {}
): RegisterArrayEditorProps['registerArray'] {
  return {
    __kind: 'array',
    name: 'ARR',
    offset: 0,
    count: 4,
    stride: 16,
    registers: regs,
    ...overrides,
  } as unknown as RegisterArrayEditorProps['registerArray'];
}

describe('RegisterArrayEditor — flat array (no nested registers)', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
  });

  it('renders the register bit-field editor directly, not the identity strip', () => {
    render(
      <RegisterArrayEditor
        registerArray={makeArray([], { fields: [] })}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={noop}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
    expect(lastRegisterEditorProps?.embedded).toBeFalsy();
    expect(lastRegisterEditorProps?.headerChildren).toBeTruthy();
  });
});

describe('RegisterArrayEditor — nested register group detail view', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
  });

  it('does not render the removed nested-register rail', () => {
    const { container } = render(
      <RegisterArrayEditor
        registerArray={makeArray([{ name: 'REG0', offset: 0, fields: [] }])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={noop}
      />
    );
    expect(container.querySelector('[data-registers-table]')).toBeNull();
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument();
  });

  it('renders the embedded RegisterEditor for template register 0 by default', () => {
    render(
      <RegisterArrayEditor
        registerArray={makeArray([
          { name: 'REG0', offset: 0, fields: [] },
          { name: 'REG1', offset: 4, fields: [] },
        ])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={noop}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
    expect(lastRegisterEditorProps?.title).toBe('REG0');
    expect(lastRegisterEditorProps?.embedded).toBe(true);
  });

  it('renders the embedded RegisterEditor for the active register from selectionMeta', () => {
    render(
      <RegisterArrayEditor
        registerArray={makeArray([
          { name: 'REG0', offset: 0, fields: [] },
          { name: 'REG1', offset: 4, fields: [] },
        ])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={noop}
        selectionMeta={{ activeRegisterIndex: 1 }}
      />
    );
    expect(lastRegisterEditorProps?.title).toBe('REG1');
  });

  it('detailUpdate prefixes plain field writes with the active template register path', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterArrayEditor
        registerArray={makeArray([
          { name: 'REG0', offset: 0, fields: [{ name: 'A', bits: '[0:0]' }] },
          { name: 'REG1', offset: 4, fields: [{ name: 'B', bits: '[0:0]' }] },
        ])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={onUpdate}
        selectionMeta={{ activeRegisterIndex: 1 }}
      />
    );
    const detailUpdate = lastRegisterEditorProps?.onUpdate;
    expect(detailUpdate).toBeDefined();
    detailUpdate!(['fields', 0, 'name'], 'X');
    expect(onUpdate).toHaveBeenCalledWith(['registers', 1, 'fields', 0, 'name'], 'X');
  });

  it('detailUpdate routes a field-move __op with __regIndex', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterArrayEditor
        registerArray={makeArray([
          {
            name: 'REG0',
            offset: 0,
            fields: [
              { name: 'A', bits: '[0:0]' },
              { name: 'B', bits: '[1:1]' },
            ],
          },
        ])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={onUpdate}
        selectionMeta={{ activeRegisterIndex: 0 }}
      />
    );
    const detailUpdate = lastRegisterEditorProps?.onUpdate;
    detailUpdate!(['__op', 'field-move'], { index: 0, delta: 1 });
    expect(onUpdate).toHaveBeenCalledWith(['__op', 'field-move'], {
      index: 0,
      delta: 1,
      __regIndex: 0,
    });
  });
});

describe('RegisterArrayEditor — inline template register identity strip', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
  });

  it('shows the active template register name, offset and description', () => {
    render(
      <RegisterArrayEditor
        registerArray={makeArray([
          { name: 'REG0', offset: 0x10, description: 'First template register', fields: [] },
        ])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={noop}
      />
    );
    expect(screen.getByText('REG0')).toBeInTheDocument();
    expect(screen.getByText('0x10')).toBeInTheDocument();
    expect(screen.getByText('First template register')).toBeInTheDocument();
  });

  it('double-clicking the name commits a rename via onUpdate', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterArrayEditor
        registerArray={makeArray([{ name: 'REG0', offset: 0, fields: [] }])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={onUpdate}
      />
    );
    fireEvent.doubleClick(screen.getByText('REG0'));
    const nameInput = document.querySelector('[data-edit-key="name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'RENAMED' } });
    expect(onUpdate).toHaveBeenCalledWith(['registers', 0, 'name'], 'RENAMED');
  });

  it('double-clicking the offset commits a numeric offset via onUpdate', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterArrayEditor
        // Non-zero offset avoids colliding with the "Base Address: 0x0" text.
        registerArray={makeArray([{ name: 'REG0', offset: 4, fields: [] }])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={onUpdate}
      />
    );
    fireEvent.doubleClick(screen.getByText('0x4'));
    const offsetInput = document.querySelector('[data-edit-key="offset"]') as HTMLInputElement;
    fireEvent.change(offsetInput, { target: { value: '16' } });
    expect(onUpdate).toHaveBeenCalledWith(['registers', 0, 'offset'], 16);
  });

  it('double-clicking the description commits via onUpdate', () => {
    const onUpdate = jest.fn();
    render(
      <RegisterArrayEditor
        registerArray={makeArray([{ name: 'REG0', offset: 0, fields: [] }])}
        arrayLayout="side-by-side"
        toggleArrayLayout={noop}
        onUpdate={onUpdate}
      />
    );
    fireEvent.doubleClick(screen.getByText('No description'));
    const descInput = document.querySelector('[data-edit-key="description"]') as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: 'A description' } });
    expect(onUpdate).toHaveBeenCalledWith(['registers', 0, 'description'], 'A description');
  });
});
