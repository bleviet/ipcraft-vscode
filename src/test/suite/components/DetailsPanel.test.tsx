/**
 * Smoke tests for DetailsPanel routing coordinator.
 *
 * Verifies that DetailsPanel mounts the correct sub-component based on
 * selectedType, without exercising the sub-component internals.
 * Sub-components are mocked to avoid pulling in heavy DOM / toolkit deps.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock heavy sub-components so this test stays fast and dependency-free
// ---------------------------------------------------------------------------

let lastRegisterEditorProps: unknown = null;

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
  BlockEditor: (_props: unknown) => <div data-testid="mock-block-editor">BlockEditor</div>,
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
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DetailsPanel — routing', () => {
  beforeEach(() => {
    lastRegisterEditorProps = null;
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
