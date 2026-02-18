// Minimal VS Code API wrapper for the webview.
// Safe to import from multiple bundles - caches the API instance globally
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalWindow = globalThis as any;

// Check if API is already acquired (cached on window object)
if (!globalWindow.__vscodeApi && globalWindow.acquireVsCodeApi) {
  try {
    globalWindow.__vscodeApi = globalWindow.acquireVsCodeApi();
  } catch (e) {
    // API already acquired by another bundle, use the existing instance
    console.warn('VS Code API already acquired, using existing instance');
  }
}

export const vscode = globalWindow.__vscodeApi;
