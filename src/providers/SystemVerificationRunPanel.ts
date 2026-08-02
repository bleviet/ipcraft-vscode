import { randomBytes } from 'crypto';
import * as vscode from 'vscode';
import type {
  SystemVerificationResult,
  SystemVerificationRouteSummary,
  SystemVerificationStage,
} from '../domain/systemVerification.types';
import type { SystemVerificationRunEvent } from '../services/systemVerification/SystemVerificationRunner';
import { Logger } from '../utils/Logger';

export interface SystemVerificationRunPanelDetails {
  readonly route?: SystemVerificationRouteSummary;
  readonly currentScenario?: string;
}

/** A typed lifecycle view. It deliberately owns no process or cancellation state. */
export class SystemVerificationRunPanel {
  private readonly logger = new Logger('SystemVerificationRunPanel');
  private disposed = false;
  private readonly firstTimestamp: number;
  private currentEvent: SystemVerificationRunEvent;
  private result: SystemVerificationResult | undefined;
  private elapsedTimer: ReturnType<typeof setInterval> | undefined;
  private readonly nonce = randomBytes(16).toString('base64');

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly details: SystemVerificationRunPanelDetails,
    initialEvent: SystemVerificationRunEvent
  ) {
    this.firstTimestamp = initialEvent.timestamp;
    this.currentEvent = initialEvent;
    this.panel.onDidDispose(() => {
      this.disposed = true;
      this.stopElapsedTimer();
      this.logger.debug('System verification run panel disposed');
    });
    this.render();
    this.elapsedTimer = setInterval(() => {
      void this.panel.webview.postMessage({
        type: 'systemVerificationElapsed',
        value: formatElapsed(this.elapsedMilliseconds()),
      });
    }, 250);
  }

  static show(
    details: SystemVerificationRunPanelDetails,
    initialEvent: SystemVerificationRunEvent
  ): SystemVerificationRunPanel {
    const panel = vscode.window.createWebviewPanel(
      'ipcraft.systemVerificationRun',
      'IPCraft: System Verification',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.file(initialEvent.runDirectory)],
      }
    );
    return new SystemVerificationRunPanel(panel, details, initialEvent);
  }

  update(event: SystemVerificationRunEvent): void {
    if (this.disposed) {
      return;
    }
    this.currentEvent = event;
    this.render();
  }

  complete(result: SystemVerificationResult, event: SystemVerificationRunEvent): void {
    if (this.disposed) {
      return;
    }
    this.currentEvent = event;
    this.result = result;
    this.stopElapsedTimer();
    this.render();
  }

  reveal(): void {
    if (!this.disposed) {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
  }

  private render(): void {
    const logsPath = this.result?.logsPath ?? this.currentEvent.logsPath;
    const waveformPath = this.result?.waveformPath ?? this.currentEvent.waveformPath;
    const logsUri = this.panel.webview.asWebviewUri(vscode.Uri.file(logsPath)).toString();
    const waveformUri = waveformPath
      ? this.panel.webview.asWebviewUri(vscode.Uri.file(waveformPath)).toString()
      : undefined;
    const elapsedMs = this.elapsedMilliseconds();
    const stage = stageLabels[this.currentEvent.stage];
    const outcome = this.result?.outcome ?? 'running';
    const firstFailure = this.result?.firstFailure ?? 'No actionable diagnostic reported.';
    const route = this.result?.route ?? this.currentEvent.route ?? this.details.route;
    const routeRows = route
      ? `<dt>Route</dt><dd><code>${escapeHtml(route.driveInterfacePath)}</code> → <code>${escapeHtml(route.instancePath)}</code></dd>
      <dt>Base address</dt><dd><code>0x${route.baseAddress.toString(16)}</code></dd>`
      : '';
    const scenarioRow = this.details.currentScenario
      ? `<dt>Scenario</dt><dd>${escapeHtml(this.details.currentScenario)}</dd>`
      : '';

    this.panel.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${escapeHtml(this.panel.webview.cspSource)} 'nonce-${escapeHtml(this.nonce)}'; script-src 'nonce-${escapeHtml(this.nonce)}';">
  <style nonce="${escapeHtml(this.nonce)}">
    :root {
      --bg: var(--vscode-editor-background);
      --bg-card: var(--vscode-sideBar-background);
      --surface: var(--vscode-toolbar-hoverBackground);
      --line: var(--vscode-panel-border);
      --text: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --nav-bg: var(--vscode-editor-background);
      --shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
      --brand: #ff512f;
      --brand-2: #dd2476;
      --grad: linear-gradient(135deg, var(--brand), var(--brand-2));
      --r: 20px;
      --max: 760px;
    }
    [data-theme="light"] {
      --bg: var(--vscode-editor-background);
      --bg-card: var(--vscode-sideBar-background);
      --surface: var(--vscode-toolbar-hoverBackground);
      --line: var(--vscode-panel-border);
      --text: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-textLink-foreground);
      --nav-bg: var(--vscode-editor-background);
      --shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 400 13px/1.6 var(--vscode-font-family, system-ui, sans-serif);
    }
    main { width: min(var(--max), calc(100% - 2.5rem)); margin: 2rem auto; }
    .eyebrow {
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    h1 { margin: 0.25rem 0 1.25rem; font-size: clamp(1.45rem, 4vw, 2.15rem); line-height: 1.08; }
    .status {
      display: grid;
      grid-template-columns: 8px minmax(0, 1fr) auto;
      gap: 0.9rem;
      align-items: center;
      padding: 1rem 1.1rem;
      background: var(--bg-card);
      border: 1px solid var(--line);
      border-radius: var(--r);
      box-shadow: var(--shadow);
    }
    .status-mark { width: 8px; height: 44px; border-radius: 999px; background: var(--grad); }
    .stage { font-size: 1.05rem; font-weight: 700; }
    .outcome { color: var(--accent); font-size: 0.74rem; font-weight: 700; text-transform: uppercase; }
    .elapsed { color: var(--muted); font-variant-numeric: tabular-nums; }
    dl { display: grid; grid-template-columns: 9rem minmax(0, 1fr); gap: 0.55rem 1rem; margin: 1.4rem 0; }
    dt { color: var(--muted); }
    dd { margin: 0; overflow-wrap: anywhere; }
    code { color: var(--accent); font-family: var(--vscode-editor-font-family, monospace); }
    .diagnostic { padding: 0.9rem 1rem; border-left: 3px solid var(--brand); background: var(--surface); }
    nav { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1.25rem; }
    a { color: var(--accent); text-decoration: none; border-bottom: 1px solid currentColor; }
    a:hover { color: var(--vscode-textLink-activeForeground); }
    @media (max-width: 520px) {
      main { width: min(100% - 1.25rem, var(--max)); margin-top: 1rem; }
      dl { grid-template-columns: 1fr; gap: 0.15rem; }
      dd { margin-bottom: 0.65rem; }
    }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">System simulation</div>
    <h1>Register-contract verification</h1>
    <section class="status" aria-label="Run status">
      <span class="status-mark" aria-hidden="true"></span>
      <div><div class="stage">${escapeHtml(stage)}</div><div class="outcome">${escapeHtml(outcome)}</div></div>
      <div id="elapsed" class="elapsed">${escapeHtml(formatElapsed(elapsedMs))}</div>
    </section>
    <dl>
      ${routeRows}
      ${scenarioRow}
      <dt>Run directory</dt><dd><code>${escapeHtml(this.currentEvent.runDirectory)}</code></dd>
    </dl>
    <section aria-label="First actionable diagnostic">
      <div class="eyebrow">First actionable diagnostic</div>
      <p class="diagnostic">${escapeHtml(firstFailure)}</p>
    </section>
    <nav aria-label="Run artifacts">
      <a href="${escapeHtml(logsUri)}">Open logs</a>
      ${waveformUri ? `<a href="${escapeHtml(waveformUri)}">Open waveform</a>` : ''}
    </nav>
  </main>
  <script nonce="${escapeHtml(this.nonce)}">
    const elapsed = document.getElementById('elapsed');
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message?.type === 'systemVerificationElapsed' && typeof message.value === 'string') {
        elapsed.textContent = message.value;
      }
    });
  </script>
</body>
</html>`;
  }

  private elapsedMilliseconds(): number {
    return Math.max(
      0,
      this.currentEvent.timestamp - this.firstTimestamp,
      this.result ? 0 : Date.now() - this.firstTimestamp
    );
  }

  private stopElapsedTimer(): void {
    clearInterval(this.elapsedTimer);
    this.elapsedTimer = undefined;
  }
}

const stageLabels: Record<SystemVerificationStage, string> = {
  preflight: 'Preflight',
  recreate: 'Recreate',
  discover: 'Discover',
  plan: 'Plan',
  compile: 'Compile',
  run: 'Run',
  complete: 'Complete',
};

function formatElapsed(elapsedMs: number): string {
  return elapsedMs < 1_000 ? `${elapsedMs} ms` : `${(elapsedMs / 1_000).toFixed(1)} s`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
