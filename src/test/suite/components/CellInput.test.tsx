import React from 'react';
import { render } from '@testing-library/react';
import { CellInput } from '../../../webview/shared/components/CellInput';

// Regression coverage for the "dropdown opens on a single click" fix: the
// dropdown variant must always accept pointer events (ignoring `isEditing`),
// while text/textarea variants keep the existing click-to-select /
// double-click-to-edit gating.
describe('CellInput pointer-events gating', () => {
  it('dropdown variant allows pointer events when not editing (opens on a single click)', () => {
    const { container } = render(
      <CellInput
        editKey="access"
        variant="dropdown"
        value="read-write"
        options={['read-write', 'read-only']}
        isEditing={false}
        onFocus={jest.fn()}
        onInput={jest.fn()}
      />
    );

    const select = container.querySelector('select[data-edit-key="access"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.style.pointerEvents).toBe('auto');
  });

  it('dropdown variant still allows pointer events when editing', () => {
    const { container } = render(
      <CellInput
        editKey="access"
        variant="dropdown"
        value="read-write"
        options={['read-write', 'read-only']}
        isEditing
        onFocus={jest.fn()}
        onInput={jest.fn()}
      />
    );

    const select = container.querySelector('select[data-edit-key="access"]') as HTMLSelectElement;
    expect(select.style.pointerEvents).toBe('auto');
  });

  it('text variant blocks pointer events until isEditing is true', () => {
    const { container, rerender } = render(
      <CellInput
        editKey="name"
        variant="text"
        value="FOO"
        isEditing={false}
        onFocus={jest.fn()}
        onInput={jest.fn()}
      />
    );

    const input = container.querySelector('input[data-edit-key="name"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.style.pointerEvents).toBe('none');

    rerender(
      <CellInput
        editKey="name"
        variant="text"
        value="FOO"
        isEditing
        onFocus={jest.fn()}
        onInput={jest.fn()}
      />
    );
    expect(input.style.pointerEvents).toBe('auto');
  });

  it('textarea variant blocks pointer events until isEditing is true', () => {
    const { container, rerender } = render(
      <CellInput
        editKey="description"
        variant="textarea"
        value="a description"
        isEditing={false}
        onFocus={jest.fn()}
        onInput={jest.fn()}
      />
    );

    const textarea = container.querySelector(
      'textarea[data-edit-key="description"]'
    ) as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.style.pointerEvents).toBe('none');

    rerender(
      <CellInput
        editKey="description"
        variant="textarea"
        value="a description"
        isEditing
        onFocus={jest.fn()}
        onInput={jest.fn()}
      />
    );
    expect(textarea.style.pointerEvents).toBe('auto');
  });
});
