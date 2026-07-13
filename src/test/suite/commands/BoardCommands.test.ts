/* eslint-disable */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import {
  registerBoardCommands,
  pickBoardDefinition,
  changeDefaultBoard,
} from '../../../commands/BoardCommands';
import { loadBoardDefinition } from '../../../generator/board/BoardDefinitionLoader';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { CONFIG_KEY_IPCRAFT_GENERATE } from '../../../utils/configKeys';

jest.mock('../../../generator/board/BoardDefinitionLoader', () => ({
  loadBoardDefinition: jest.fn(),
}));

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return { ...actual, readdir: jest.fn() };
});

const repoRoot = require('path').resolve(__dirname, '../../../..');
const resourceRoots = devResourceRoots(repoRoot);

// registerBoardCommands only stores resourceRoots in a module-scoped variable used by
// pickBoardDefinition/changeDefaultBoard — the context itself is unused beyond that.
const fakeContext = { subscriptions: [] } as unknown as vscode.ExtensionContext;

function mockBoardFiles(entries: Array<{ file: string; name: string; device: string }>): void {
  (fs.readdir as unknown as jest.Mock).mockResolvedValue(entries.map((e) => e.file));
  (loadBoardDefinition as jest.Mock).mockImplementation(async (boardPath: string) => {
    const file = String(boardPath).split(/[\\/]/).pop();
    const entry = entries.find((e) => e.file === file);
    if (!entry) {
      throw new Error(`no fixture for ${boardPath}`);
    }
    return { name: entry.name, device: entry.device };
  });
}

function mockGenerateConfig(initial: Record<string, unknown> = {}) {
  const store = { ...initial };
  const update = jest.fn((key: string, value: unknown) => {
    store[key] = value;
    return Promise.resolve();
  });
  const get = jest.fn((key: string, defaultValue?: unknown) => store[key] ?? defaultValue);
  (vscode.workspace.getConfiguration as jest.Mock).mockImplementation((section?: string) => {
    if (section === CONFIG_KEY_IPCRAFT_GENERATE) {
      return { get, update };
    }
    return { get: jest.fn((_k: string, d?: unknown) => d), update: jest.fn() };
  });
  return { get, update, store };
}

describe('BoardCommands default-board picking (issue #83)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    registerBoardCommands(fakeContext, resourceRoots);
  });

  it('never prompts when only one board is bundled, regardless of the defaultBoard setting (AC4)', async () => {
    mockBoardFiles([{ file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' }]);
    mockGenerateConfig({ defaultBoard: '' });

    const result = await pickBoardDefinition();

    expect(result).toContain('de10_nano.board.yml');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('prompts via the picker when multiple boards are bundled and no default is set, and can save the pick as default (AC2)', async () => {
    mockBoardFiles([
      { file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' },
      { file: 'other.board.yml', name: 'OtherBoard', device: 'XC7Z020' },
    ]);
    const cfg = mockGenerateConfig({ defaultBoard: '' });
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce({
        label: 'DE10-Nano',
        description: '5CSEBA6U23I7',
        file: 'de10_nano.board.yml',
      })
      .mockResolvedValueOnce(undefined);
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Not Now');

    const result = await pickBoardDefinition();

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(result).toContain('de10_nano.board.yml');
    expect(cfg.update).not.toHaveBeenCalled();
  });

  it('persists "Set as Default" when the user opts in from the picker (AC2)', async () => {
    mockBoardFiles([
      { file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' },
      { file: 'other.board.yml', name: 'OtherBoard', device: 'XC7Z020' },
    ]);
    const cfg = mockGenerateConfig({ defaultBoard: '' });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce({
      label: 'OtherBoard',
      description: 'XC7Z020',
      file: 'other.board.yml',
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Set as Default');

    await pickBoardDefinition();

    expect(cfg.update).toHaveBeenCalledWith(
      'defaultBoard',
      'other.board.yml',
      vscode.ConfigurationTarget.Global
    );
  });

  it('skips the picker and uses the saved default board when one is configured (AC3)', async () => {
    mockBoardFiles([
      { file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' },
      { file: 'other.board.yml', name: 'OtherBoard', device: 'XC7Z020' },
    ]);
    mockGenerateConfig({ defaultBoard: 'other.board.yml' });

    const result = await pickBoardDefinition();

    expect(result).toContain('other.board.yml');
    expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
  });

  it('falls back to the picker when the configured default board is no longer in the catalog', async () => {
    mockBoardFiles([
      { file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' },
      { file: 'other.board.yml', name: 'OtherBoard', device: 'XC7Z020' },
    ]);
    mockGenerateConfig({ defaultBoard: 'removed.board.yml' });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      label: 'DE10-Nano',
      description: '5CSEBA6U23I7',
      file: 'de10_nano.board.yml',
    });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValue('Not Now');

    const result = await pickBoardDefinition();

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(1);
    expect(result).toContain('de10_nano.board.yml');
  });

  it('changeDefaultBoard sets the chosen board as default', async () => {
    mockBoardFiles([
      { file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' },
      { file: 'other.board.yml', name: 'OtherBoard', device: 'XC7Z020' },
    ]);
    const cfg = mockGenerateConfig({ defaultBoard: '' });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      label: 'OtherBoard',
      description: 'XC7Z020',
      file: 'other.board.yml',
    });

    await changeDefaultBoard();

    expect(cfg.update).toHaveBeenCalledWith(
      'defaultBoard',
      'other.board.yml',
      vscode.ConfigurationTarget.Global
    );
  });

  it('changeDefaultBoard clears the default when "Clear default" is chosen', async () => {
    mockBoardFiles([
      { file: 'de10_nano.board.yml', name: 'DE10-Nano', device: '5CSEBA6U23I7' },
      { file: 'other.board.yml', name: 'OtherBoard', device: 'XC7Z020' },
    ]);
    const cfg = mockGenerateConfig({ defaultBoard: 'other.board.yml' });
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValue({
      label: '$(close) Clear default (always ask)',
      file: '__clear__',
    });

    await changeDefaultBoard();

    expect(cfg.update).toHaveBeenCalledWith('defaultBoard', '', vscode.ConfigurationTarget.Global);
  });
});
