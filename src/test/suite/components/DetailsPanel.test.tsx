/**
 * Smoke tests for DetailsPanel routing coordinator.
 *
 * Verifies that DetailsPanel mounts the correct sub-component based on
 * selectedType, without exercising the sub-component internals.
 * Sub-components are mocked to keep this test focused on panel behavior.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock heavy sub-components so this test stays fast and dependency-free
// ---------------------------------------------------------------------------

let lastRegisterEditorProps: unknown = null;
let lastBlockEditorProps: unknown = null;

jest.mock('../../../webview/components/register/RegisterEditor', () => ({
  RegisterEditor: React.forwardRef((props: unknown, _ref: unknown) => {
    lastRegisterEditorProps = props;
    return <div data-testid="mock-register-editor">RegisterEditor</div>;
  }),
}));

jest.mock('../../../webview/components/memorymap/MemoryMapEditor', () => ({
  MemoryMapEditor: (_props: unknown) => (
    <div data-testid="mock-memorymap-editor">MemoryMapEditor</div>
  ),
}));

jest.mock('../../../webview/components/memorymap/BlockEditor', () => ({
  BlockEditor: (props: unknown) => {
    lastBlockEditorProps = props;
    return <div data-testid="mock-block-editor">BlockEditor</div>;
  },
}));

jest.mock('../../../webview/components/memorymap/RegisterArrayEditor', () => ({
  RegisterArrayEditor: (_props: unknown) => (
    <div data-testid="mock-registerarray-editor">RegisterArrayEditor</div>
  ),
}));

// ---------------------------------------------------------------------------
// Subject under test (imported *after* mocks)
// ---------------------------------------------------------------------------

import DetailsPanel from '../../../webview/components/DetailsPanel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = jest.fn();

const baseProps = {
  registerLayout: 'side-by-side' as const,
  toggleRegisterLayout: noop,
  blockLayout: 'stacked' as const,
  toggleBlockLayout: noop,
  memoryMapLayout: 'stacked' as const,
  toggleMemoryMapLayout: noop,
  arrayLayout: 'stacked' as const,
  toggleArrayLayout: noop,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DetailsPanel — routing', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
    lastBlockEditorProps = null;
  });

  it('renders the empty-state when selectedObject is null', () => {
    render(
      <DetailsPanel selectedType={null} selectedObject={null} onUpdate={noop} {...baseProps} />
    );
    expect(screen.getByText(/select an item/i)).toBeInTheDocument();
  });

  it('renders RegisterEditor for selectedType="register"', () => {
    const mockRegister = { name: 'CTRL', fields: [] };
    render(
      <DetailsPanel
        selectedType="register"
        selectedObject={mockRegister}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
    const firstCall = lastRegisterEditorProps as
      | { registerLayout?: string; toggleRegisterLayout?: unknown }
      | undefined;
    expect(firstCall?.registerLayout).toBe('side-by-side');
    expect(firstCall?.toggleRegisterLayout).toBe(noop);
  });

  it('renders MemoryMapEditor for selectedType="memoryMap"', () => {
    const mockMap = { name: 'my_map', blocks: [] };
    render(
      <DetailsPanel
        selectedType="memoryMap"
        selectedObject={mockMap}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-memorymap-editor')).toBeInTheDocument();
  });

  it('renders BlockEditor for selectedType="block"', () => {
    const mockBlock = { name: 'APB', registers: [] };
    render(
      <DetailsPanel
        selectedType="block"
        selectedObject={mockBlock}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-block-editor')).toBeInTheDocument();
  });

  it('forwards selectionMeta.activeRegisterIndex to BlockEditor for a block selection', () => {
    // Master-detail: the Outline emits a block selection carrying the register
    // to pre-select in the detail pane. DetailsPanel must pass it straight
    // through to BlockEditor.
    const mockBlock = { name: 'APB', registers: [{ name: 'REG0', fields: [] }] };
    render(
      <DetailsPanel
        selectedType="block"
        selectedObject={mockBlock}
        selectionMeta={{
          activeRegisterIndex: 1,
          focusDetails: true,
          absoluteAddress: 0x100,
        }}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-block-editor')).toBeInTheDocument();
    const props = lastBlockEditorProps as {
      selectionMeta?: {
        activeRegisterIndex?: number;
        focusDetails?: boolean;
        absoluteAddress?: number;
      };
      registerLayout?: string;
      toggleRegisterLayout?: unknown;
    } | null;
    expect(props?.selectionMeta?.activeRegisterIndex).toBe(1);
    expect(props?.selectionMeta?.focusDetails).toBe(true);
    expect(props?.registerLayout).toBe('side-by-side');
    expect(props?.toggleRegisterLayout).toBe(noop);
  });

  it('renders RegisterArrayEditor for selectedType="array"', () => {
    const mockArray = { name: 'TIMER', count: 4, stride: 4 };
    render(
      <DetailsPanel
        selectedType="array"
        selectedObject={mockArray}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-registerarray-editor')).toBeInTheDocument();
  });

  it('masquerades single-register array element as RegisterEditor', () => {
    const mockArray = {
      name: 'TIMER',
      __element_index: 0,
      registers: [{ name: 'CTRL', fields: [] }],
    };
    render(
      <DetailsPanel
        selectedType="array"
        selectedObject={mockArray}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
  });

  it('masquerades flat-array element (fields, no nested registers) as RegisterEditor', () => {
    const mockArray = {
      name: 'CH_GAIN',
      __element_index: 0,
      __element_base: 0x40,
      count: 4,
      stride: 4,
      fields: [{ name: 'GAIN', bits: '[11:0]' }],
    };
    render(
      <DetailsPanel
        selectedType="array"
        selectedObject={mockArray}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-register-editor')).toBeInTheDocument();
    const props = lastRegisterEditorProps as
      | { register?: { name?: string }; fields?: unknown[] }
      | undefined;
    // The element edits the array's own shared field template directly.
    expect(props?.register?.name).toBe('CH_GAIN');
    expect(props?.fields).toHaveLength(1);
  });

  it('masquerades multi-register array element as BlockEditor', () => {
    const mockArray = {
      name: 'TIMER',
      __element_index: 0,
      registers: [
        { name: 'CTRL', fields: [] },
        { name: 'STATUS', fields: [] },
      ],
    };
    render(
      <DetailsPanel
        selectedType="array"
        selectedObject={mockArray}
        onUpdate={noop}
        {...baseProps}
      />
    );
    expect(screen.getByTestId('mock-block-editor')).toBeInTheDocument();
  });
});
