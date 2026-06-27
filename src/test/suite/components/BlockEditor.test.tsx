/**
 * BlockEditor master-detail tests.
 *
 * The block screen is a master-detail: an editable register rail (left) plus
 * the selected register's bit-field detail (an embedded RegisterEditor, right).
 * These tests verify the detail routing and the register-scoped `detailUpdate`
 * wrapper that prefixes field writes with the active register path and carries
 * `__regIndex` for `__op` field operations.
 *
 * RegisterEditor is mocked to capture its `onUpdate` (the `detailUpdate`
 * wrapper), mirroring the mock-and-capture style in DetailsPanel.test.tsx.
 * RegisterMapVisualizer (the rail) is stubbed since selection is driven by
 * `selectionMeta.activeRegisterIndex`, not card clicks.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

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

jest.mock('../../../webview/components/RegisterMapVisualizer', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'mock-rail' }),
}));

import {
  BlockEditor,
  type AddressBlockModel,
} from '../../../webview/components/memorymap/BlockEditor';

const noop = jest.fn();

function makeBlock(regs: Array<Record<string, unknown>>): AddressBlockModel {
  return { name: 'BLOCK', base_address: 0, registers: regs } as unknown as AddressBlockModel;
}

describe('BlockEditor — master-detail', () => {
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
    expect(screen.getByText('No registers yet. Press o to add one.')).toBeInTheDocument();
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
