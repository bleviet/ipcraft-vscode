import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ResetCell from '../../../webview/components/register/ResetCell';
import type { FieldDef } from '../../../webview/components/register/FieldsTable';
import { VersionContextProvider } from '../../../webview/hooks/useVersionContext';
import type { VersionContext } from '../../../shared/versioning/versionContext';
import type { VersionRefIssue } from '../../../shared/versioning/validateVersionRefs';

let mockDebugMode = false;
jest.mock('../../../webview/hooks/useDebugMode', () => ({
  useDebugMode: () => ({ debugMode: mockDebugMode, toggleDebugMode: jest.fn() }),
}));

const resolved: VersionContext = {
  status: 'resolved',
  versionScheme: 'major.minor.patch',
  version: '1.4.2',
};

function renderCell(
  field: FieldDef,
  value = '0x0',
  options: { context?: VersionContext; issues?: VersionRefIssue[]; error?: string | null } = {}
) {
  const onUpdate = jest.fn();
  const onDraftChange = jest.fn();
  const onErrorChange = jest.fn();
  render(
    <VersionContextProvider>
      <table>
        <tbody>
          <tr>
            <ResetCell
              field={field}
              index={2}
              isActive={false}
              isEditing={true}
              value={value}
              error={options.error ?? null}
              issues={options.issues}
              onCellClick={jest.fn()}
              onFocus={jest.fn()}
              onDraftChange={onDraftChange}
              onErrorChange={onErrorChange}
              onUpdate={onUpdate}
            />
          </tr>
        </tbody>
      </table>
    </VersionContextProvider>
  );
  if (options.context) {
    const context = options.context;
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'versionContext', context } })
      );
    });
  }
  const input = screen.getByLabelText<HTMLInputElement>('reset');
  const type = (text: string) => fireEvent.change(input, { target: { value: text } });
  return { onUpdate, onDraftChange, onErrorChange, type };
}

const byte: FieldDef = { name: 'f', bits: '[7:0]', offset: 0, width: 8, resetValue: 0 };
const tokenByte: FieldDef = { ...byte, versionRef: '$version.major' };

beforeEach(() => {
  mockDebugMode = false;
});

describe('ResetCell numeric input', () => {
  it('commits a 0x hex value once and clears the error', () => {
    const { onUpdate, onDraftChange, onErrorChange, type } = renderCell(byte);
    type('0xFF');
    expect(onDraftChange).toHaveBeenCalledWith('0xFF');
    expect(onErrorChange).toHaveBeenLastCalledWith(null);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['fields', 2, 'resetValue'], 255);
  });

  it('commits a decimal value', () => {
    const { onUpdate, type } = renderCell(byte);
    type('42');
    expect(onUpdate).toHaveBeenCalledWith(['fields', 2, 'resetValue'], 42);
  });

  it('reports a value too large for the field and does not commit', () => {
    const { onUpdate, onErrorChange, type } = renderCell(byte);
    type('0x1FF');
    expect(onErrorChange).toHaveBeenLastCalledWith('Reset too large for 8 bit(s)');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('commits null for empty text', () => {
    const { onUpdate, onErrorChange, type } = renderCell(byte);
    type('  ');
    expect(onErrorChange).toHaveBeenLastCalledWith(null);
    expect(onUpdate).toHaveBeenCalledWith(['fields', 2, 'resetValue'], null);
  });

  it.each(['A', 'FF', '1_0', '0x'])(
    'reports "Invalid number" for %s and does not commit',
    (text) => {
      const { onUpdate, onErrorChange, type } = renderCell(byte);
      type(text);
      expect(onErrorChange).toHaveBeenLastCalledWith('Invalid number');
      expect(onUpdate).not.toHaveBeenCalled();
    }
  );
});

describe('ResetCell $version references', () => {
  it('commits a valid token once, as the token text', () => {
    const { onUpdate, onDraftChange, onErrorChange, type } = renderCell(byte);
    type('$version.major');
    expect(onDraftChange).toHaveBeenCalledWith('$version.major');
    expect(onErrorChange).toHaveBeenLastCalledWith(null);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['fields', 2, 'resetValue'], '$version.major');
  });

  it.each(['$version.foo', '$ver', '$'])('rejects %s without committing', (text) => {
    const { onUpdate, onErrorChange, type } = renderCell(byte);
    type(text);
    expect(onErrorChange).toHaveBeenLastCalledWith(
      'Unknown version reference. Use $version, $version.<component>, $version.crc8 or $version.crc16'
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('lists the scheme references when a scheme is resolved', () => {
    const { onUpdate, onErrorChange, type } = renderCell(byte, '0x0', { context: resolved });
    type('$version.foo');
    expect(onErrorChange).toHaveBeenLastCalledWith(
      'Use $version, $version.major, $version.minor, $version.patch, $version.crc8 or $version.crc16'
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('commits a number typed over a token field', () => {
    const { onUpdate, type } = renderCell(tokenByte, '$version.major');
    type('0x12');
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(['fields', 2, 'resetValue'], 0x12);
  });

  it('refuses a token in Debug Mode without committing', () => {
    mockDebugMode = true;
    const { onUpdate, onErrorChange, type } = renderCell(byte);
    type('$version.major');
    expect(onErrorChange).toHaveBeenLastCalledWith(
      'Version references cannot be set in Debug Mode'
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'treats blur of an unchanged token field as a no-op (debugMode=%s)',
    (debugMode) => {
      mockDebugMode = debugMode;
      const { onUpdate, onErrorChange } = renderCell(tokenByte, '$version.major');
      fireEvent.blur(screen.getByLabelText<HTMLInputElement>('reset'));
      expect(onErrorChange).toHaveBeenLastCalledWith(null);
      expect(onUpdate).not.toHaveBeenCalled();
    }
  );

  it('still refuses a different token in Debug Mode on a token field', () => {
    mockDebugMode = true;
    const { onUpdate, onErrorChange, type } = renderCell(tokenByte, '$version.major');
    type('$version.minor');
    expect(onErrorChange).toHaveBeenLastCalledWith(
      'Version references cannot be set in Debug Mode'
    );
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows the resolved value under the token, padded to the field width', () => {
    renderCell(tokenByte, '$version.major', { context: resolved });
    expect(screen.getByLabelText<HTMLInputElement>('reset').value).toBe('$version.major');
    expect(screen.getByTestId('version-ref-hint')).toHaveTextContent('= 0x01');
  });

  it('shows "version unresolved" when no IP core version is known', () => {
    renderCell(tokenByte, '$version.major');
    expect(screen.getByTestId('version-ref-hint')).toHaveTextContent('version unresolved');
  });

  it('says several IP cores import the map when the context is ambiguous', () => {
    renderCell(tokenByte, '$version.major', {
      context: { status: 'ambiguous', candidates: ['a.ip.yml', 'b.ip.yml'] },
    });
    expect(screen.getByTestId('version-ref-hint')).toHaveTextContent(
      'several IP cores import this map'
    );
  });

  it('shows no hint on a plain numeric field', () => {
    renderCell(byte, '0x5', { context: resolved });
    expect(screen.queryByTestId('version-ref-hint')).toBeNull();
  });

  it('lists the field issues under the cell, errors and warnings styled apart', () => {
    renderCell(tokenByte, '$version.major', {
      issues: [
        { severity: 'error', code: 'versionRef.width', path: [], message: 'needs 8 bits' },
        { severity: 'warning', code: 'versionRef.access', path: [], message: 'Access is ignored' },
      ],
    });
    const error = screen.getByText('needs 8 bits');
    const warning = screen.getByText('Access is ignored');
    expect(error).toHaveClass('vscode-error');
    expect(error).toHaveAttribute('data-severity', 'error');
    expect(warning).toHaveAttribute('data-severity', 'warning');
    expect(warning).not.toHaveClass('vscode-error');
  });
});
