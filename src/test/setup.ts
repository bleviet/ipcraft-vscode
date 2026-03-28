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
