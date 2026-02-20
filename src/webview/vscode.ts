interface WebviewApi<StateType = unknown> {
  postMessage(message: unknown): void;
  getState(): StateType | undefined;
  setState(state: StateType): void;
}

declare global {
  interface Window {
    __vscodeApi?: WebviewApi;
    acquireVsCodeApi?(): WebviewApi;
  }
}

// Minimal VS Code API wrapper for the webview.
// Safe to import from multiple bundles - caches the API instance globally

// Check if API is already acquired (cached on window object)
if (!window.__vscodeApi && window.acquireVsCodeApi) {
  try {
    window.__vscodeApi = window.acquireVsCodeApi();
  } catch (e) {
    // API already acquired by another bundle, use the existing instance
    // eslint-disable-next-line no-console
    console.warn('VS Code API already acquired, using existing instance');
  }
}

export const vscode = window.__vscodeApi;
