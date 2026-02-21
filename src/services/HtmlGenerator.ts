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
    return this.generateHtmlForEditor(webview, {
      scriptName: 'webview.js',
      styleName: 'webview.css',
      rootId: 'root',
      title: 'Memory Map Editor',
      logMessage: 'Generating HTML for webview',
    });
  }

  /**
   * Generate HTML for IP Core editor webview
   */
  generateIpCoreHtml(webview: vscode.Webview): string {
    return this.generateHtmlForEditor(webview, {
      scriptName: 'ipcore.js',
      styleName: 'ipcore.css',
      rootId: 'ipcore-root',
      title: 'IP Core Editor',
      logMessage: 'Generating IP Core HTML for webview',
    });
  }

  private generateHtmlForEditor(
    webview: vscode.Webview,
    options: {
      scriptName: string;
      styleName: string;
      rootId: string;
      title: string;
      logMessage: string;
    }
  ): string {
    const scriptUri = this.getWebviewUri(webview, 'dist', options.scriptName);
    const stylesheetUri = this.getWebviewUri(webview, 'dist', options.styleName);
    const codiconsUri = this.getWebviewUri(
      webview,
      'node_modules',
      '@vscode/codicons',
      'dist',
      'codicon.css'
    );

    const csp = this.getContentSecurityPolicy(webview);

    this.logger.debug(options.logMessage);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${csp}
        ${this.getStylesheets(codiconsUri, stylesheetUri)}
        <title>${options.title}</title>
      </head>
      <body class="bg-gray-50 text-gray-900 font-sans h-screen flex flex-col overflow-hidden">
        <div id="${options.rootId}"></div>
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
   */
  private getContentSecurityPolicy(webview: vscode.Webview): string {
    return `
      <meta
        http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource};
                 font-src ${webview.cspSource};
                 script-src ${webview.cspSource};"
      >
    `;
  }

  /**
   * Get stylesheet links
   */
  private getStylesheets(codiconsUri: vscode.Uri, stylesheetUri: vscode.Uri): string {
    return `
      <link href="${codiconsUri.toString()}" rel="stylesheet" />
      <link href="${stylesheetUri.toString()}" rel="stylesheet" />
    `;
  }
}
