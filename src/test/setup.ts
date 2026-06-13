/* eslint-disable */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import '@testing-library/jest-dom';

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
    VSCodeTextArea: ({ onInput, ...props }: any) =>
      React.createElement('textarea', {
        ...props,
        onInput: (e: any) => onInput?.(e),
        onChange: (e: any) => onInput?.(e),
      }),
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
