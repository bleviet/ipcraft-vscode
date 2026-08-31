import * as vscode from 'vscode';
import type { SystemVerificationResult } from '../../../domain/systemVerification.types';
import { SystemVerificationRunPanel } from '../../../providers/SystemVerificationRunPanel';
import type { SystemVerificationRunEvent } from '../../../services/systemVerification/SystemVerificationRunner';

describe('SystemVerificationRunPanel', () => {
  let disposeListener: (() => void) | undefined;
  let panel: vscode.WebviewPanel;

  beforeEach(() => {
    disposeListener = undefined;
    panel = {
      webview: {
        html: '',
        cspSource: 'webview-resource:',
        postMessage: jest.fn(async () => true),
        asWebviewUri: jest.fn((uri: vscode.Uri) => ({
          toString: () => `webview:${uri.fsPath}`,
        })),
      },
      reveal: jest.fn(),
      dispose: jest.fn(),
      onDidDispose: jest.fn((listener: () => void) => {
        disposeListener = listener;
        return { dispose: jest.fn() };
      }),
    } as unknown as vscode.WebviewPanel;
    (vscode.window.createWebviewPanel as jest.Mock).mockReturnValue(panel);
    (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => ({
      fsPath,
      toString: () => fsPath,
    }));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('omits route and scenario until structured route metadata is available', () => {
    const initialEvent: SystemVerificationRunEvent = {
      stage: 'preflight',
      timestamp: 1_000,
      runDirectory: '/workspace/.ipcraft/system-verification/run-a',
      logsPath: '/workspace/.ipcraft/system-verification/run-a/system-verification.log',
    };
    const view = SystemVerificationRunPanel.show({}, initialEvent);

    expect(panel.webview.html).not.toContain('<dt>Route</dt>');
    expect(panel.webview.html).not.toContain('<dt>Base address</dt>');
    expect(panel.webview.html).not.toContain('<dt>Scenario</dt>');

    const route = {
      driveInterfacePath: '/S_AXI_TEST',
      instancePath: '/control_0',
      baseAddress: 0x44a00000,
    };
    const result: SystemVerificationResult = {
      outcome: 'passed',
      runDirectory: initialEvent.runDirectory,
      logsPath: initialEvent.logsPath,
      route,
    };
    view.complete(result, {
      ...initialEvent,
      stage: 'complete',
      timestamp: 1_500,
      route,
    });

    expect(panel.webview.html).toContain('/S_AXI_TEST');
    expect(panel.webview.html).toContain('/control_0');
    expect(panel.webview.html).toContain('0x44a00000');
    expect(panel.webview.html).not.toContain('<dt>Scenario</dt>');
  });

  it('renders typed lifecycle state, route, scenario, elapsed time, diagnostics, and artifact links', () => {
    const initialEvent: SystemVerificationRunEvent = {
      stage: 'preflight',
      timestamp: 1_000,
      runDirectory: '/workspace/.ipcraft/system-verification/run-a',
      logsPath: '/workspace/.ipcraft/system-verification/run-a/system-verification.log',
    };
    const view = SystemVerificationRunPanel.show(
      {
        route: {
          driveInterfacePath: '/S_AXI_TEST',
          instancePath: '/control_0',
          baseAddress: 0x44a00000,
        },
        currentScenario: 'CONTROL write/readback',
      },
      initialEvent
    );
    const lifecycle: SystemVerificationRunEvent = {
      ...initialEvent,
      stage: 'run',
      timestamp: 1_250,
    };
    const result: SystemVerificationResult = {
      outcome: 'failed',
      runDirectory: '/workspace/.ipcraft/system-verification/run-a',
      logsPath: '/workspace/.ipcraft/system-verification/run-a/system-verification.log',
      waveformPath: '/workspace/.ipcraft/system-verification/run-a/system.wdb',
      firstFailure: 'CONTROL response=SLVERR',
    };

    view.update(lifecycle);
    view.complete(result, { ...initialEvent, stage: 'complete', timestamp: 1_500 });

    const html = panel.webview.html;
    expect(html).toContain('Complete');
    expect(html).toContain('500 ms');
    expect(html).toContain('/S_AXI_TEST');
    expect(html).toContain('/control_0');
    expect(html).toContain('0x44a00000');
    expect(html).toContain('CONTROL write/readback');
    expect(html).toContain('CONTROL response=SLVERR');
    expect(html).toContain(
      'webview:/workspace/.ipcraft/system-verification/run-a/system-verification.log'
    );
    expect(html).toContain('webview:/workspace/.ipcraft/system-verification/run-a/system.wdb');
  });

  it('escapes typed values rather than interpreting them as markup or terminal output', () => {
    const initialEvent: SystemVerificationRunEvent = {
      stage: 'preflight',
      timestamp: 0,
      runDirectory: '/run',
      logsPath: '/run/log.txt',
    };
    const view = SystemVerificationRunPanel.show(
      {
        route: {
          driveInterfacePath: '<script>terminal()</script>',
          instancePath: '/target',
          baseAddress: 0,
        },
        currentScenario: '<img src=x onerror=terminal()>',
      },
      initialEvent
    );

    view.complete(
      {
        outcome: 'failed',
        runDirectory: '/run',
        logsPath: '/run/log.txt',
        firstFailure: '<b>raw terminal text</b>',
      },
      { ...initialEvent, stage: 'complete', timestamp: 10 }
    );

    expect(panel.webview.html).not.toContain('<script>terminal()</script>');
    expect(panel.webview.html).not.toContain('<img src=x onerror=terminal()>');
    expect(panel.webview.html).not.toContain('<b>raw terminal text</b>');
    expect(panel.webview.html).toContain('&lt;b&gt;raw terminal text&lt;/b&gt;');
  });

  it('disposes safely without cancelling or otherwise controlling the running process', () => {
    const initialEvent: SystemVerificationRunEvent = {
      stage: 'preflight',
      timestamp: 0,
      runDirectory: '/run',
      logsPath: '/run/log.txt',
    };
    const view = SystemVerificationRunPanel.show(
      {
        route: { driveInterfacePath: '/S_AXI', instancePath: '/target', baseAddress: 0 },
        currentScenario: 'Reset reads',
      },
      initialEvent
    );
    const htmlBeforeDispose = panel.webview.html;

    disposeListener?.();
    view.update({ ...initialEvent, stage: 'run', timestamp: 20 });

    expect(panel.webview.html).toBe(htmlBeforeDispose);
    expect(panel.dispose).not.toHaveBeenCalled();
  });

  it('refreshes elapsed time while a lifecycle stage is still running', () => {
    jest.useFakeTimers();
    jest.setSystemTime(1_000);
    const initialEvent: SystemVerificationRunEvent = {
      stage: 'preflight',
      timestamp: 1_000,
      runDirectory: '/run',
      logsPath: '/run/log.txt',
    };
    const view = SystemVerificationRunPanel.show(
      {
        route: { driveInterfacePath: '/S_AXI', instancePath: '/target', baseAddress: 0 },
        currentScenario: 'Reset reads',
      },
      initialEvent
    );

    expect(panel.webview.html).toContain('0 ms');
    const initialHtml = panel.webview.html;
    jest.advanceTimersByTime(1_250);
    expect(panel.webview.html).toBe(initialHtml);
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith({
      type: 'systemVerificationElapsed',
      value: '1.3 s',
    });

    view.complete(
      { outcome: 'passed', runDirectory: '/run', logsPath: '/run/log.txt' },
      { ...initialEvent, stage: 'complete', timestamp: 2_500 }
    );
    jest.advanceTimersByTime(2_000);
    expect(panel.webview.html).toContain('1.5 s');
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(5);
  });
});
