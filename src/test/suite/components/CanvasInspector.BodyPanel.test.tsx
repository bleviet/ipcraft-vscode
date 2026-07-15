/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasInspector } from '../../../webview/ipcore/components/canvas/CanvasInspector';
import type { IpCore } from '../../../webview/types/ipCore';
import type { CanvasElement } from '../../../webview/ipcore/hooks/useCanvasSelection';

const bodySelection: CanvasElement = { kind: 'body', index: 0, id: 'body' };

function baseIpCore(overrides: Partial<IpCore> = {}): IpCore {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'test_core', version: '1.0.0' },
    ...overrides,
  } as IpCore;
}

describe('CanvasInspector BodyPanel — Author field (issue #86)', () => {
  it('renders the Author field in the Details section, above Description', () => {
    render(
      <CanvasInspector
        selected={bodySelection}
        ipCore={baseIpCore()}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );

    const authorInput = screen.getByPlaceholderText('Author name or team');
    const descriptionInput = screen.getByPlaceholderText('Describe this IP core…');
    expect(authorInput).toBeInTheDocument();
    expect(descriptionInput).toBeInTheDocument();

    // Author must precede Description in DOM order (positioned above it, per issue #86)
    const position = authorInput.compareDocumentPosition(descriptionInput);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the existing author value and commits edits via onUpdate on blur', () => {
    const onUpdate = jest.fn();
    render(
      <CanvasInspector
        selected={bodySelection}
        ipCore={baseIpCore({ author: 'Jane Doe' })}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const authorInput = screen.getByPlaceholderText('Author name or team') as HTMLInputElement;
    expect(authorInput.value).toBe('Jane Doe');

    fireEvent.change(authorInput, { target: { value: 'John Smith' } });
    fireEvent.blur(authorInput);

    expect(onUpdate).toHaveBeenCalledWith(['author'], 'John Smith');
  });

  it('clearing the author field commits null, matching the Description field convention', () => {
    const onUpdate = jest.fn();
    render(
      <CanvasInspector
        selected={bodySelection}
        ipCore={baseIpCore({ author: 'Jane Doe' })}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );

    const authorInput = screen.getByPlaceholderText('Author name or team') as HTMLInputElement;
    fireEvent.change(authorInput, { target: { value: '' } });
    fireEvent.blur(authorInput);

    expect(onUpdate).toHaveBeenCalledWith(['author'], null);
  });
});
