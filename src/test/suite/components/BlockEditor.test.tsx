/**
 * BlockEditor detail-view tests.
 *
 * BlockEditor shows a single block's active register: an editable identity
 * strip (name/offset/description) plus the selected register's bit-field
 * detail (an embedded RegisterEditor). The register list itself — select,
 * insert, delete, reorder, rename — lives entirely in the Outline panel, not
 * here; these tests verify detail routing, the register-scoped `detailUpdate`
 * wrapper, and the inline identity strip.
 *
 * RegisterEditor is mocked to capture its `onUpdate` (the `detailUpdate`
 * wrapper), mirroring the mock-and-capture style in DetailsPanel.test.tsx.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

interface CapturedRegisterEditorProps {
  onUpdate?: (path: (string | number)[], value: unknown) => void;
  register?: { name?: string };
  title?: string;
  embedded?: boolean;
}

let lastRegisterEditorProps: CapturedRegisterEditorProps | null = null;

jest.mock('../../../webview/components/register/RegisterEditor', () => ({
  RegisterEditor: React.forwardRef((props: unknown, _ref: unknown) => {
    lastRegisterEditorProps = props as CapturedRegisterEditorProps;
    return React.createElement('div', { 'data-testid': 'mock-register-editor' });
  }),
}));

import {
  BlockEditor,
  type AddressBlockModel,
} from '../../../webview/components/memorymap/BlockEditor';

const noop = jest.fn();

function makeBlock(regs: Array<Record<string, unknown>>): AddressBlockModel {
  return { name: 'BLOCK', base_address: 0, registers: regs };
}

describe('BlockEditor — register detail view', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
  });

  it('shows the no-registers prompt when the block has no registers', () => {
    render(
      <BlockEditor
        block={makeBlock([])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={noop}
      />
    );
    expect(
      screen.getByText('No registers yet. Select this block in the outline and press o to add one.')
    ).toBeInTheDocument();
  });

  it('does not render the removed register rail', () => {
    const { container } = render(
      <BlockEditor
        block={makeBlock([{ name: 'REG0', offset: 0, fields: [] }])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={noop}
      />
    );
    expect(container.querySelector('[data-regs-table]')).toBeNull();
    expect(screen.queryByLabelText('Drag to reorder')).not.toBeInTheDocument();
  });

  it('renders the embedded RegisterEditor for register 0 by default', () => {
    render(
      <BlockEditor
        block={makeBlock([
          { name: 'REG0', offset: 0, fields: [] },
          { name: 'REG1', offset: 4, fields: [] },
        ])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={noop}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
    expect(lastRegisterEditorProps?.title).toBe('REG0');
    expect(lastRegisterEditorProps?.embedded).toBe(true);
  });

  it('renders the embedded RegisterEditor for the active register from selectionMeta', () => {
    render(
      <BlockEditor
        block={makeBlock([
          { name: 'REG0', offset: 0, fields: [] },
          { name: 'REG1', offset: 4, fields: [] },
        ])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={noop}
        selectionMeta={{ activeRegisterIndex: 1 }}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
    expect(lastRegisterEditorProps?.title).toBe('REG1');
  });

  it('detailUpdate prefixes plain field writes with the active register path', () => {
    const onUpdate = jest.fn();
    render(
      <BlockEditor
        block={makeBlock([
          { name: 'REG0', offset: 0, fields: [{ name: 'A', bits: '[0:0]' }] },
          { name: 'REG1', offset: 4, fields: [{ name: 'B', bits: '[0:0]' }] },
        ])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
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
      <BlockEditor
        block={makeBlock([
          {
            name: 'REG0',
            offset: 0,
            fields: [
              { name: 'A', bits: '[0:0]' },
              { name: 'B', bits: '[1:1]' },
            ],
          },
        ])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={onUpdate}
        selectionMeta={{ activeRegisterIndex: 0 }}
      />
    );
    const detailUpdate = lastRegisterEditorProps?.onUpdate;
    expect(detailUpdate).toBeDefined();
    detailUpdate!(['__op', 'field-move'], { index: 0, delta: 1 });
    expect(onUpdate).toHaveBeenCalledWith(['__op', 'field-move'], {
      index: 0,
      delta: 1,
      __regIndex: 0,
    });
  });
});

describe('BlockEditor — inline register identity strip', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
  });

  it('shows the active register name, offset and description', () => {
    render(
      <BlockEditor
        block={makeBlock([
          { name: 'REG0', offset: 0x10, description: 'First register', fields: [] },
        ])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={noop}
      />
    );
    expect(screen.getByText('REG0')).toBeInTheDocument();
    expect(screen.getByText('0x10')).toBeInTheDocument();
    expect(screen.getByText('First register')).toBeInTheDocument();
  });

  it('double-clicking the name commits a rename via onUpdate', () => {
    const onUpdate = jest.fn();
    render(
      <BlockEditor
        block={makeBlock([{ name: 'REG0', offset: 0, fields: [] }])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={onUpdate}
      />
    );
    fireEvent.doubleClick(screen.getByText('REG0'));
    const nameInput = document.querySelector('[data-edit-key="name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'RENAMED' } });
    expect(onUpdate).toHaveBeenCalledWith(['registers', 0, 'name'], 'RENAMED');
  });

  it('rejects a duplicate sibling name', () => {
    const onUpdate = jest.fn();
    render(
      <BlockEditor
        block={makeBlock([
          { name: 'REG0', offset: 0, fields: [] },
          { name: 'REG1', offset: 4, fields: [] },
        ])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={onUpdate}
        selectionMeta={{ activeRegisterIndex: 0 }}
      />
    );
    fireEvent.doubleClick(screen.getByText('REG0'));
    const nameInput = document.querySelector('[data-edit-key="name"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'REG1' } });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Name is already used')).toBeInTheDocument();
  });

  it('double-clicking the offset commits a numeric offset via onUpdate', () => {
    const onUpdate = jest.fn();
    render(
      <BlockEditor
        block={makeBlock([{ name: 'REG0', offset: 0, fields: [] }])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={onUpdate}
      />
    );
    fireEvent.doubleClick(screen.getByText('0x0'));
    const offsetInput = document.querySelector('[data-edit-key="offset"]') as HTMLInputElement;
    fireEvent.change(offsetInput, { target: { value: '16' } });
    expect(onUpdate).toHaveBeenCalledWith(['registers', 0, 'offset'], 16);
  });

  it('double-clicking the description commits via onUpdate', () => {
    const onUpdate = jest.fn();
    render(
      <BlockEditor
        block={makeBlock([{ name: 'REG0', offset: 0, fields: [] }])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={onUpdate}
      />
    );
    fireEvent.doubleClick(screen.getByText('No description'));
    const descInput = document.querySelector('[data-edit-key="description"]') as HTMLInputElement;
    fireEvent.change(descInput, { target: { value: 'A description' } });
    expect(onUpdate).toHaveBeenCalledWith(['registers', 0, 'description'], 'A description');
  });

  it('does not render the identity strip when no register is active', () => {
    render(
      <BlockEditor
        block={makeBlock([])}
        registerLayout="side-by-side"
        toggleRegisterLayout={noop}
        onUpdate={noop}
      />
    );
    expect(document.querySelector('[data-edit-key="name"]')).toBeNull();
  });
});
