import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { StagingPanel } from '../../../providers/StagingPanel';
import { WebviewStagingBridge } from '../../../providers/WebviewStagingBridge';
import { runGenerator } from '../../../services/GenerationEngine';
import type { ResourceRoots } from '../../../services/ResourceRoots';

jest.mock('../../../generator/IpCoreScaffolder', () => ({
  IpCoreScaffolder: jest.fn(),
  applyExecutableMode: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../generator/TemplateLoader', () => ({
  TemplateLoader: jest.fn(),
}));

describe('runGenerator (issue #195)', () => {
  const savedYaml = 'busInterfaces:\n  - name: avl_st\n    endianness: big\n';
  const editorYaml = 'busInterfaces:\n  - name: avl_st\n    endianness: little\n';
  const changedAfterPreviewYaml =
    'busInterfaces:\n  - name: avl_st\n    endianness: big\n# changed after preview\n';

  let tmpDir: string;
  let ipCorePath: string;
  let currentEditorText: string;
  let generateAll: jest.Mock;
  let saveDocument: jest.Mock;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-generation-engine-'));
    ipCorePath = path.join(tmpDir, 'preview_endian.ip.yml');
    fs.writeFileSync(ipCorePath, savedYaml);
    currentEditorText = editorYaml;
    saveDocument = jest.fn().mockResolvedValue(true);

    Object.assign(vscode, {
      ProgressLocation: { Notification: 15 },
    });
    Object.assign(vscode.window, {
      withProgress: jest.fn(
        async (_options: unknown, task: () => Promise<void>): Promise<void> => task()
      ),
    });
    Object.assign(vscode.workspace, {
      getConfiguration: jest.fn(() => ({
        get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
      })),
      openTextDocument: jest.fn().mockImplementation(async () => ({
        getText: () => currentEditorText,
        lineCount: 1,
        lineAt: () => ({ lineNumber: 0, text: currentEditorText }),
        save: saveDocument,
        uri: { fsPath: ipCorePath },
      })),
    });

    generateAll = jest
      .fn()
      .mockImplementation(
        async (_inputPath: string, _outputDir: string, options: { sourceText?: string }) => {
          const usesLittleEndian = options.sourceText?.includes('endianness: little') === true;
          return {
            success: true,
            ipCoreName: 'preview_endian',
            generatedContents: {
              'altera/preview_endian_hw.tcl':
                `set_interface_property avl_st firstSymbolInHighOrderBits ` +
                `${usesLittleEndian ? 'false' : 'true'}\n`,
            },
          };
        }
      );
    (IpCoreScaffolder as jest.Mock).mockImplementation(() => ({ generateAll }));

    jest.spyOn(WebviewStagingBridge.getInstance(), 'showInWebview').mockResolvedValue(null);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it('previews and writes one in-memory document snapshot without saving the IP core', async () => {
    let previewedContent = '';
    jest.spyOn(StagingPanel, 'show').mockImplementation(async (files) => {
      previewedContent = files[0].content;
      currentEditorText = changedAfterPreviewYaml;
      return { confirmed: true, mergedPaths: [], overwritePaths: [] };
    });

    const result = await runGenerator(
      {} as ResourceRoots,
      {} as vscode.ExtensionContext,
      { fsPath: ipCorePath } as vscode.Uri,
      tmpDir,
      {
        targets: ['quartus'],
        includeVhdl: false,
        includeRegs: false,
        includeTestbench: false,
        silent: true,
      },
      'Generating Platform Designer component...'
    );

    const generatedPath = path.join(tmpDir, 'altera', 'preview_endian_hw.tcl');
    expect(result).toEqual({ success: true, ipCoreName: 'preview_endian' });
    expect(previewedContent).toContain('firstSymbolInHighOrderBits false');
    expect(fs.readFileSync(generatedPath, 'utf8')).toBe(previewedContent);
    expect(fs.readFileSync(ipCorePath, 'utf8')).toBe(savedYaml);
    expect(vscode.workspace.openTextDocument).toHaveBeenCalledTimes(1);
    expect(generateAll).toHaveBeenCalledWith(
      ipCorePath,
      tmpDir,
      expect.objectContaining({ sourceText: editorYaml, dryRun: true })
    );
  });

  it('leaves the IP-core document dirty when generation updates its YAML metadata', async () => {
    generateAll.mockResolvedValue({
      success: true,
      ipCoreName: 'preview_endian',
      generatedContents: {
        'rtl/preview_endian.vhd': '-- generated from the snapshot\n',
      },
      resolvedPackName: 'builtin-ipcraft',
    });
    jest.spyOn(StagingPanel, 'show').mockResolvedValue({
      confirmed: true,
      mergedPaths: [],
      overwritePaths: [],
    });

    const result = await runGenerator(
      {} as ResourceRoots,
      {} as vscode.ExtensionContext,
      { fsPath: ipCorePath } as vscode.Uri,
      tmpDir,
      {
        targets: [],
        updateYaml: true,
        silent: true,
      },
      'Generating HDL...'
    );

    expect(result).toEqual({ success: true, ipCoreName: 'preview_endian' });
    expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(2);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(fs.readFileSync(ipCorePath, 'utf8')).toBe(savedYaml);
  });
});
