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

describe('CanvasInspector BodyPanel — version scheme', () => {
  function renderBody(
    version: unknown,
    versionScheme?: string,
    onUpdate: jest.Mock = jest.fn()
  ): jest.Mock {
    render(
      <CanvasInspector
        selected={bodySelection}
        ipCore={baseIpCore({
          vlnv: { vendor: 'test', library: 'lib', name: 'test_core', version, versionScheme },
        } as Partial<IpCore>)}
        onUpdate={onUpdate}
        onClose={jest.fn()}
      />
    );
    return onUpdate;
  }
  const schemeSelect = () => screen.getByLabelText('Version scheme') as HTMLSelectElement;
  const versionInput = () => screen.getByLabelText('Version') as HTMLInputElement;

  function commitVersion(value: string): void {
    fireEvent.change(versionInput(), { target: { value } });
    fireEvent.blur(versionInput());
  }

  it('renders the selector directly above the Version field with the four options in order', () => {
    renderBody('1.0.0');
    const options = Array.from(schemeSelect().options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['free', 'Free text'],
      ['major.minor', 'MAJOR.MINOR'],
      ['major.minor.patch', 'MAJOR.MINOR.PATCH'],
      ['major.feature.minor.patch', 'MAJOR.FEATURE.MINOR.PATCH'],
    ]);
    expect(
      schemeSelect().compareDocumentPosition(versionInput()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows Free text when versionScheme is absent', () => {
    renderBody('1.0.0');
    expect(schemeSelect().value).toBe('free');
    expect(screen.getByRole('option', { name: 'Free text' })).toBeInTheDocument();
  });

  it('shows the stored scheme', () => {
    renderBody('1.0.0', 'major.minor.patch');
    expect(schemeSelect().value).toBe('major.minor.patch');
  });

  it('writes the scheme string for a numeric scheme and never touches the version', () => {
    const onUpdate = renderBody('1.0.0');
    fireEvent.change(schemeSelect(), { target: { value: 'major.feature.minor.patch' } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['vlnv', 'versionScheme'], 'major.feature.minor.patch');
  });

  it('deletes the key (undefined) when switching back to free', () => {
    const onUpdate = renderBody('1.0.0', 'major.minor.patch');
    fireEvent.change(schemeSelect(), { target: { value: 'free' } });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['vlnv', 'versionScheme'], undefined);
  });

  it.each([
    ['free', '1.0.0'],
    ['major.minor', '1.0'],
    ['major.minor.patch', '1.0.0'],
    ['major.feature.minor.patch', '1.0.0.0'],
  ])('uses the %s placeholder %s', (scheme, placeholder) => {
    renderBody(placeholder, scheme);
    expect(versionInput().placeholder).toBe(placeholder);
  });

  it('accepts 1.0 under major.minor and commits it', () => {
    const onUpdate = renderBody('2.0', 'major.minor');
    commitVersion('1.0');
    expect(onUpdate).toHaveBeenCalledWith(['vlnv', 'version'], '1.0');
  });

  it('rejects 1.0 under major.minor.patch: reverts and does not commit', () => {
    const onUpdate = renderBody('1.0.0', 'major.minor.patch');
    fireEvent.change(versionInput(), { target: { value: '1.0' } });
    fireEvent.blur(versionInput());
    expect(onUpdate).not.toHaveBeenCalled();
    expect(versionInput().value).toBe('1.0.0');
  });

  it('rejects a component above 255', () => {
    const onUpdate = renderBody('1.0', 'major.minor');
    fireEvent.change(versionInput(), { target: { value: '256.0' } });
    fireEvent.blur(versionInput());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('accepts any non-empty text under free', () => {
    const onUpdate = renderBody('1.0.0');
    commitVersion('2024-rc1');
    expect(onUpdate).toHaveBeenCalledWith(['vlnv', 'version'], '2024-rc1');
  });

  it('does not flag a valid version', () => {
    renderBody('1.0.0', 'major.minor.patch');
    expect(versionInput()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByText(/Format: MAJOR/)).not.toBeInTheDocument();
  });

  it('flags a stored version that does not fit the stored scheme, without editing it', () => {
    const onUpdate = renderBody('1.0', 'major.minor.patch');
    expect(versionInput().value).toBe('1.0');
    expect(versionInput()).toHaveAttribute('aria-invalid', 'true');
    expect(versionInput().className).toContain('ci-field__input--error');
    expect(screen.getByText('Format: MAJOR.MINOR.PATCH, each 0-255 (e.g. "1.0.0")')).toHaveClass(
      'ci-field__error'
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('flags the version after switching to a stricter scheme', () => {
    const view = render(
      <CanvasInspector
        selected={bodySelection}
        ipCore={baseIpCore({
          vlnv: { vendor: 'test', library: 'lib', name: 'test_core', version: '1.0.0' },
        })}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(versionInput()).not.toHaveAttribute('aria-invalid');
    view.rerender(
      <CanvasInspector
        selected={bodySelection}
        ipCore={baseIpCore({
          vlnv: {
            vendor: 'test',
            library: 'lib',
            name: 'test_core',
            version: '1.0.0',
            versionScheme: 'major.minor',
          },
        } as Partial<IpCore>)}
        onUpdate={jest.fn()}
        onClose={jest.fn()}
      />
    );
    expect(versionInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Format: MAJOR.MINOR, each 0-255 (e.g. "1.0")')).toBeInTheDocument();
  });

  it('renders a numeric version (unquoted YAML `version: 1.2`) as valid under major.minor', () => {
    expect(() => renderBody(1.2, 'major.minor')).not.toThrow();
    expect(versionInput().value).toBe('1.2');
    expect(versionInput()).not.toHaveAttribute('aria-invalid');
  });

  it('renders a missing version with the Required error instead of crashing', () => {
    expect(() => renderBody(undefined)).not.toThrow();
    expect(versionInput().value).toBe('');
    expect(versionInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Required')).toHaveClass('ci-field__error');
  });

  it('renders a missing version under a numeric scheme with the format hint instead of crashing', () => {
    expect(() => renderBody(undefined, 'major.minor')).not.toThrow();
    expect(versionInput().value).toBe('');
    expect(versionInput()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Format: MAJOR.MINOR, each 0-255 (e.g. "1.0")')).toBeInTheDocument();
  });

  it('flags an out-of-range component of the stored version', () => {
    renderBody('256.0', 'major.minor');
    expect(screen.getByText("Component 'major' must be 0-255")).toBeInTheDocument();
  });
});
