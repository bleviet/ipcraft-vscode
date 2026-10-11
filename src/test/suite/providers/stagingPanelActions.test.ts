import * as vscode from 'vscode';
import { StagingPanel, type StagedFile } from '../../../providers/StagingPanel';
import { STAGING_ACTION_DESCRIPTIONS } from '../../../shared/staging';

const modified = (overrides: Partial<StagedFile>): StagedFile => ({
  relativePath: 'rtl/a_core.vhd',
  status: 'modified',
  protected: false,
  content: 'generated',
  diskPath: '/out/rtl/a_core.vhd',
  actions: ['keep', 'overwrite', 'sync-interface', 'auto-merge'],
  defaultAction: 'auto-merge',
  ...overrides,
});

// The shared vscode mock has no ViewColumn enum.
(vscode as unknown as { ViewColumn: unknown }).ViewColumn = { Beside: 2 };

function showPanel(files: StagedFile[]) {
  let onMessage: (m: unknown) => Promise<void> = async () => undefined;
  const panel = {
    webview: {
      html: '',
      onDidReceiveMessage: jest.fn((cb: typeof onMessage) => {
        onMessage = cb;
        return { dispose: jest.fn() };
      }),
      postMessage: jest.fn(),
    },
    onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
    dispose: jest.fn(),
  };
  (vscode.window as unknown as { createWebviewPanel: jest.Mock }).createWebviewPanel = jest.fn(
    () => panel
  );
  const decision = StagingPanel.show(files);
  return { panel, decision, send: (m: unknown) => onMessage(m) };
}

describe('StagingPanel fallback action selector', () => {
  it('renders the choice in UI order seeded from defaultAction, with badges', () => {
    const { panel } = showPanel([
      modified({
        handEdited: true,
        interfaceDrift: { added: ['p_new'], removed: [], changed: ['q'] },
      }),
    ]);
    const html = panel.webview.html;
    const order = [...html.matchAll(/data-choice="([a-z-]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['auto-merge', 'sync-interface', 'overwrite', 'keep']);
    expect(html).toContain('class="choice choice-active" data-choice="auto-merge"');
    expect(html).toContain('Hand-edited');
    expect(html).toContain('Interface out of date: +1/-0/~1');
    expect(html).toContain('"rtl/a_core.vhd":"auto-merge"');
  });

  it('describes each action in a tooltip', () => {
    const { panel } = showPanel([modified({})]);
    expect(panel.webview.html).toContain(
      `data-choice="keep" data-path="rtl/a_core.vhd" title="${STAGING_ACTION_DESCRIPTIONS.keep}"`
    );
  });

  it('mutes a file whose default action is keep', () => {
    const { panel } = showPanel([modified({ protected: true, defaultAction: 'keep' })]);
    expect(panel.webview.html).toContain('tree-file-row muted');
  });

  it('returns the validated actions map on apply', async () => {
    const { decision, send } = showPanel([modified({})]);
    await send({
      type: 'apply',
      actions: { 'rtl/a_core.vhd': 'sync-interface', 'rtl/b.vhd': 'bogus' },
    });
    await expect(decision).resolves.toEqual({
      confirmed: true,
      mergedPaths: [],
      actions: { 'rtl/a_core.vhd': 'sync-interface' },
    });
  });
});
