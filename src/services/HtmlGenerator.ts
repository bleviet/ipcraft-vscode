import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';

/**
 * Service responsible for generating HTML content for the webview
 */
export class HtmlGenerator {
  private readonly logger = new Logger('HtmlGenerator');

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Generate the complete HTML document for the webview
   */
  generateHtml(webview: vscode.Webview): string {
    const scriptUri = this.getWebviewUri(webview, 'dist', 'webview.js');
    const codiconsUri = this.getWebviewUri(
      webview,
      'node_modules',
      '@vscode/codicons',
      'dist',
      'codicon.css'
    );

    const csp = this.getContentSecurityPolicy(webview);

    this.logger.debug('Generating HTML for webview');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${csp}
        ${this.getStylesheets(codiconsUri)}
        ${this.getInlineStyles()}
        <title>Memory Map Editor</title>
      </head>
      <body class="bg-gray-50 text-gray-900 font-sans h-screen flex flex-col overflow-hidden">
        <div id="root"></div>
        <script src="${scriptUri.toString()}"></script>
      </body>
      </html>
    `;
  }

  /**
   * Generate HTML for IP Core editor webview
   */
  generateIpCoreHtml(webview: vscode.Webview): string {
    const scriptUri = this.getWebviewUri(webview, 'dist', 'ipcore.js');
    const codiconsUri = this.getWebviewUri(
      webview,
      'node_modules',
      '@vscode/codicons',
      'dist',
      'codicon.css'
    );

    const csp = this.getContentSecurityPolicy(webview);

    this.logger.debug('Generating IP Core HTML for webview');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${csp}
        ${this.getStylesheets(codiconsUri)}
        ${this.getInlineStyles()}
        <title>IP Core Editor</title>
      </head>
      <body class="bg-gray-50 text-gray-900 font-sans h-screen flex flex-col overflow-hidden">
        <div id="ipcore-root"></div>
        <script src="${scriptUri.toString()}"></script>
      </body>
      </html>
    `;
  }

  /**
   * Get a webview URI for a resource in the extension
   */
  private getWebviewUri(webview: vscode.Webview, ...pathSegments: string[]): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, ...pathSegments));
  }

  /**
   * Generate Content Security Policy meta tag
   * TODO: Remove unsafe-inline and external CDN references for better security
   */
  private getContentSecurityPolicy(webview: vscode.Webview): string {
    return `
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com;
                 font-src ${webview.cspSource} https://fonts.gstatic.com;
                 script-src ${webview.cspSource} 'unsafe-inline' https://cdn.tailwindcss.com;"
      >
    `;
  }

  /**
   * Get stylesheet links
   */
  private getStylesheets(codiconsUri: vscode.Uri): string {
    return `
      <link href="${codiconsUri.toString()}" rel="stylesheet" />
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              fontFamily: {
                sans: ['var(--vscode-font-family)', 'sans-serif'],
                mono: ['var(--vscode-editor-font-family)', 'monospace'],
              },
              colors: {
                gray: {
                  50: 'var(--vscode-editor-background)',
                  100: 'var(--vscode-sideBar-background)',
                  200: 'var(--vscode-panel-border)',
                  300: 'var(--vscode-input-border)',
                  400: 'var(--vscode-descriptionForeground)',
                  500: 'var(--vscode-foreground)',
                  600: 'var(--vscode-foreground)',
                  700: 'var(--vscode-foreground)',
                  800: 'var(--vscode-foreground)',
                  900: 'var(--vscode-foreground)',
                  950: 'var(--vscode-editor-background)',
                }
              }
            }
          }
        }
      </script>
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200" rel="stylesheet" />
    `;
  }

  /**
   * Get inline styles for the webview
   */
  private getInlineStyles(): string {
    return `
      <style>
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
        .bit-cell { transition: all 0.2s ease; }
        .bit-cell:hover { transform: translateY(-2px); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); z-index: 10; }
        .highlight-row { background-color: var(--vscode-list-hoverBackground); border-left-color: var(--vscode-focusBorder); }
        .highlight-bit { opacity: 1 !important; transform: scale(1.05); z-index: 20; box-shadow: 0 0 0 2px var(--vscode-focusBorder); }
        .dim-bit { opacity: 0.4; }
      </style>
    `;
  }
}
