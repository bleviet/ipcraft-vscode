/* eslint-disable */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// jsdom omits TextEncoder/TextDecoder, but the extension runs in Node where they
// are global. Provide them so extension-side modules behave as they do at runtime.
if (typeof (global as any).TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof (global as any).TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}

// jsdom does not implement ResizeObserver, but webview components (e.g. the
// address-map ruler, GeneratorPanel) use it. Provide a no-op stub.
if (typeof (global as any).ResizeObserver === 'undefined') {
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement Element.scrollIntoView, but the rail/tables scroll
// the selected row into view. Provide a no-op stub so selection-driven effects
// do not throw.
if (typeof (Element.prototype as any).scrollIntoView !== 'function') {
  (Element.prototype as any).scrollIntoView = function noopScrollIntoView() {};
}

// jsdom does not implement PointerEvent. Provide a minimal polyfill extending
// MouseEvent so components using onPointerDown/onPointerMove (e.g. the register
// rail's drag-to-reorder) can be exercised with fireEvent.pointerDown, including
// modifier keys (ctrlKey) and button.
if (typeof (global as any).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends window.MouseEvent {
    pointerId: number;
    pointerType: string;
    width: number;
    height: number;
    isPrimary: boolean;
    constructor(type: string, init: any = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (global as any).PointerEvent = PointerEventPolyfill;
  (window as any).PointerEvent = PointerEventPolyfill;
}

// Mock VS Code API for webview tests
(global as any).acquireVsCodeApi = () => ({
  postMessage: jest.fn(),
  getState: jest.fn(),
  setState: jest.fn(),
});

// Unit tests must explicitly assert diagnostics they intentionally trigger, then clear
// the corresponding mock. Anything left behind fails the test instead of producing a
// green run with warning noise that can hide a real regression.
let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;
let emitWarningSpy: jest.SpyInstance;

function formatCalls(calls: any[][]): string {
  return calls
    .map((args) => args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '))
    .join('\n');
}

beforeEach(() => {
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  emitWarningSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => undefined);

  const versionDetector = require('../utils/detectVivadoVersion').detectVivadoVersion;
  if (jest.isMockFunction(versionDetector)) {
    versionDetector.mockReturnValue('2024.2');
  }
});

afterEach(() => {
  const unexpected = [
    ['console.warn', consoleWarnSpy.mock.calls],
    ['console.error', consoleErrorSpy.mock.calls],
    ['process warning', emitWarningSpy.mock.calls],
  ].filter(([, calls]) => (calls as any[][]).length > 0) as Array<[string, any[][]]>;

  consoleWarnSpy.mockRestore();
  consoleErrorSpy.mockRestore();
  emitWarningSpy.mockRestore();

  if (unexpected.length > 0) {
    throw new Error(
      unexpected.map(([source, calls]) => `Unexpected ${source}:\n${formatCalls(calls)}`).join('\n')
    );
  }
});

// Component XML generation asks this boundary for host tool information. Unit tests use
// deterministic version metadata; detectVivadoVersion.test.ts explicitly unmocks it.
jest.mock('../utils/detectVivadoVersion', () => ({
  detectVivadoVersion: jest.fn(() => '2024.2'),
}));

// Mock @vscode/webview-ui-toolkit/react
jest.mock('@vscode/webview-ui-toolkit/react', () => {
  const React = require('react');
  return {
    VSCodeTextField: React.forwardRef(({ onInput, ...props }: any, ref: any) =>
      React.createElement('input', {
        ref,
        ...props,
        onInput: (e: any) => onInput?.(e),
        onChange: (e: any) => onInput?.(e),
      })
    ),
    VSCodeTextArea: React.forwardRef(({ onInput, ...props }: any, ref: any) =>
      React.createElement('textarea', {
        ref,
        ...props,
        onInput: (e: any) => onInput?.(e),
        onChange: (e: any) => onInput?.(e),
      })
    ),
    VSCodeCheckbox: ({ onChange, checked, children, ...props }: any) =>
      React.createElement('label', { key: props.id || props.name }, [
        React.createElement('input', {
          key: 'input',
          type: 'checkbox',
          checked,
          onChange: (e: any) => onChange?.(e),
          ...props,
        }),
        children,
      ]),
    VSCodeDropdown: React.forwardRef(({ onChange, children, ...props }: any, ref: any) =>
      React.createElement(
        'select',
        {
          ref,
          onChange: (e: any) => onChange?.(e),
          ...props,
        },
        children
      )
    ),
    VSCodeOption: ({ children, ...props }: any) => React.createElement('option', props, children),
  };
});
