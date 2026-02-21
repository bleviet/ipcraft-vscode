export function createNotIpCoreHtml(): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: var(--vscode-font-family);
          padding: 20px;
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
        }
        .error-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 80vh;
          text-align: center;
        }
        .error-icon { font-size: 48px; margin-bottom: 16px; }
        .error-title { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
        .error-message { opacity: 0.7; }
      </style>
    </head>
    <body>
      <div class="error-container">
        <div class="error-icon">Warning</div>
        <div class="error-title">Not an IP Core File</div>
        <div class="error-message">
          This file does not appear to be an IP core YAML file.<br>
          Expected: <code>apiVersion</code> and <code>vlnv</code> fields.
        </div>
      </div>
    </body>
    </html>
  `;
}
