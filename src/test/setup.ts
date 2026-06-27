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

// Suppress console errors in tests unless explicitly needed
const originalError = console.error;
beforeAll(() => {
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning: ReactDOM.render') ||
        args[0].includes('Not implemented: HTMLFormElement.prototype.submit'))
    ) {
      return;
    }
    // Fail fast on render loops. "Maximum update depth exceeded" means a component
    // is calling setState in an effect whose dependency changes every render
    // (e.g. an unmemoised/`?? []` array fed into a reconcile effect). React merely
    // warns and bails at 50 iterations, so without this guard a real infinite loop
    // hides behind a green exit code.
    if (typeof args[0] === 'string' && args[0].includes('Maximum update depth exceeded')) {
      throw new Error(
        'Render loop detected: "Maximum update depth exceeded". A component is ' +
          'calling setState inside an effect whose dependency changes on every render.'
      );
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Mock @vscode/webview-ui-toolkit/react
jest.mock('@vscode/webview-ui-toolkit/react', () => {
  const React = require('react');
  return {
    VSCodeTextField: ({ onInput, ...props }: any) =>
      React.createElement('input', {
        ...props,
        onInput: (e: any) => onInput?.(e),
        onChange: (e: any) => onInput?.(e),
      }),
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
    VSCodeDropdown: ({ onChange, children, ...props }: any) =>
      React.createElement(
        'select',
        {
          onChange: (e: any) => onChange?.(e),
          ...props,
        },
        children
      ),
    VSCodeOption: ({ children, ...props }: any) => React.createElement('option', props, children),
  };
});
