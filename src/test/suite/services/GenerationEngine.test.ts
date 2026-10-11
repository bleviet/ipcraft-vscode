import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { StagingPanel } from '../../../providers/StagingPanel';
import { WebviewStagingBridge } from '../../../providers/WebviewStagingBridge';
import { runGenerator, formatGenerationFailure } from '../../../services/GenerationEngine';
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
      return { confirmed: true, mergedPaths: [], actions: {} };
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
      actions: {},
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

  describe('formatGenerationFailure', () => {
    const issue = (severity: 'error' | 'warning', message: string) => ({
      code: 'X',
      severity,
      source: 'protocol' as const,
      path: [],
      message,
    });

    it('appends the first error issue and a count of the rest', () => {
      expect(
        formatGenerationFailure('Blocked.', [
          issue('warning', 'warn'),
          issue('error', 'first error'),
          issue('error', 'second error'),
        ])
      ).toBe('Generation failed: Blocked. first error (+2 more)');
    });

    it('falls back to the first issue when none is an error', () => {
      expect(formatGenerationFailure('Blocked.', [issue('warning', 'warn')])).toBe(
        'Generation failed: Blocked. warn'
      );
    });

    it('leaves the message unchanged without issues', () => {
      expect(formatGenerationFailure(undefined, undefined)).toBe(
        'Generation failed: Unknown error'
      );
      expect(formatGenerationFailure('Boom', [])).toBe('Generation failed: Boom');
    });
  });

  it('returns structured conformance issues without constructing a staging result', async () => {
    const issues = [
      {
        code: 'BUS_MEMORY_MAP_UNSUPPORTED',
        severity: 'error' as const,
        source: 'protocol' as const,
        path: ['busInterfaces', 0, 'memoryMapRef'],
        message: 'The unresolved bus type cannot own a memory map.',
      },
    ];
    generateAll.mockResolvedValue({
      success: false,
      error: 'Generation blocked by bus interface conformance issues.',
      issues,
    });
    const showInWebview = jest.spyOn(WebviewStagingBridge.getInstance(), 'showInWebview');
    const showStaging = jest.spyOn(StagingPanel, 'show');

    const result = await runGenerator(
      {} as ResourceRoots,
      {} as vscode.ExtensionContext,
      { fsPath: ipCorePath } as vscode.Uri,
      tmpDir,
      { targets: [], silent: true },
      'Generating HDL...'
    );

    expect(result).toEqual({ success: false, issues });
    expect(showInWebview).not.toHaveBeenCalled();
    expect(showStaging).not.toHaveBeenCalled();
  });

  describe('generation baseline and staging actions (issue #236)', () => {
    const baselinePath = (rel: string) => path.join(tmpDir, '.ipcraft', 'baseline', rel);
    const run = (updateYaml = false) =>
      runGenerator(
        {} as ResourceRoots,
        {} as vscode.ExtensionContext,
        { fsPath: ipCorePath } as vscode.Uri,
        tmpDir,
        { targets: [], updateYaml, silent: true },
        'Generating HDL...'
      );
    const stageContents = (
      generatedContents: Record<string, string>,
      protectedPaths: string[] = []
    ) => {
      generateAll.mockResolvedValue({
        success: true,
        ipCoreName: 'preview_endian',
        generatedContents,
        protectedPaths,
      });
    };
    const writeDisk = (rel: string, content: string) => {
      const target = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    };

    it('writes baselines for written files, not for kept files, and keeps them out of fileSets', async () => {
      writeDisk('rtl/locked.vhd', 'user locked\n');
      stageContents({ 'rtl/new.vhd': 'new generated\n', 'rtl/locked.vhd': 'generated\n' }, [
        'rtl/locked.vhd',
      ]);
      jest.spyOn(StagingPanel, 'show').mockResolvedValue({
        confirmed: true,
        mergedPaths: [],
        actions: {},
      });

      await run(true);

      expect(fs.readFileSync(baselinePath('rtl/new.vhd'), 'utf8')).toBe('new generated\n');
      expect(fs.existsSync(baselinePath('rtl/locked.vhd'))).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, 'rtl/locked.vhd'), 'utf8')).toBe('user locked\n');
      const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0] as {
        replace: jest.Mock;
      };
      const yamlText = String(edit.replace.mock.calls[0][2]);
      expect(yamlText).toContain('new.vhd');
      expect(yamlText).not.toContain('.ipcraft');
    });

    it('seeds the baseline of unchanged files and writes overwritten content as baseline', async () => {
      writeDisk('rtl/same.vhd', 'same\n');
      writeDisk('rtl/old.vhd', 'old\n');
      stageContents({ 'rtl/same.vhd': 'same\n', 'rtl/old.vhd': 'regenerated\n' });
      jest.spyOn(StagingPanel, 'show').mockResolvedValue({
        confirmed: true,
        mergedPaths: [],
        actions: {},
      });

      await run();

      expect(fs.readFileSync(baselinePath('rtl/same.vhd'), 'utf8')).toBe('same\n');
      expect(fs.readFileSync(path.join(tmpDir, 'rtl/old.vhd'), 'utf8')).toBe('regenerated\n');
      expect(fs.readFileSync(baselinePath('rtl/old.vhd'), 'utf8')).toBe('regenerated\n');
    });

    it('writes the merged content for a hand-edited file when the action is auto-merge', async () => {
      const base = 'line1\nline2\nline3\n';
      writeDisk('rtl/core.vhd', 'line1\nuser edit\nline3\n');
      writeDisk('.ipcraft/baseline/rtl/core.vhd', base);
      stageContents({ 'rtl/core.vhd': 'line1\nline2\nline3\ngenerated tail\n' });
      let defaultAction: string | undefined;
      jest.spyOn(StagingPanel, 'show').mockImplementation(async (files) => {
        defaultAction = files[0].defaultAction;
        return { confirmed: true, mergedPaths: [], actions: { 'rtl/core.vhd': 'auto-merge' } };
      });

      await run();

      expect(defaultAction).toBe('auto-merge');
      expect(fs.readFileSync(path.join(tmpDir, 'rtl/core.vhd'), 'utf8')).toBe(
        'line1\nuser edit\nline3\ngenerated tail\n'
      );
      expect(fs.readFileSync(baselinePath('rtl/core.vhd'), 'utf8')).toBe(
        'line1\nline2\nline3\ngenerated tail\n'
      );
    });

    it('writes the synced content and updates the baseline to the generated content on sync-interface', async () => {
      const entity = (ports: string, body: string) =>
        `library ieee;\nentity foo_core is\n  port (\n    clk : in std_logic${ports}\n  );\nend entity foo_core;\narchitecture rtl of foo_core is\nbegin\n${body}\nend architecture rtl;\n`;
      const onDisk = entity('', '  user <= clk;');
      const generated = entity(';\n    irq : out std_logic', '  -- body');
      writeDisk('rtl/foo_core.vhd', onDisk);
      stageContents({ 'rtl/foo_core.vhd': generated });
      jest.spyOn(StagingPanel, 'show').mockResolvedValue({
        confirmed: true,
        mergedPaths: [],
        actions: { 'rtl/foo_core.vhd': 'sync-interface' },
      });

      await run();

      const written = fs.readFileSync(path.join(tmpDir, 'rtl/foo_core.vhd'), 'utf8');
      expect(written).toContain('irq : out std_logic');
      expect(written).toContain('user <= clk;');
      expect(fs.readFileSync(baselinePath('rtl/foo_core.vhd'), 'utf8')).toBe(generated);
    });

    it('attaches interface drift to a protected modified VHDL file and defaults it to keep', async () => {
      const entity = (ports: string) =>
        `library ieee;\nentity foo_core is\n  port (\n    clk : in std_logic${ports}\n  );\nend entity foo_core;\narchitecture rtl of foo_core is\nbegin\nend architecture rtl;\n`;
      writeDisk('rtl/foo_core.vhd', entity(''));
      stageContents({ 'rtl/foo_core.vhd': entity(';\n    irq : out std_logic') }, [
        'rtl/foo_core.vhd',
      ]);
      let staged: Parameters<typeof StagingPanel.show>[0] = [];
      jest.spyOn(StagingPanel, 'show').mockImplementation(async (files) => {
        staged = files;
        return { confirmed: true, mergedPaths: [], actions: {} };
      });

      await run();

      expect(staged[0].protected).toBe(true);
      expect(staged[0].interfaceDrift).toEqual({ added: ['irq'], removed: [], changed: [] });
      expect(staged[0].defaultAction).toBe('keep');
    });

    it('skips kept and merge-editor files without touching their baselines', async () => {
      writeDisk('rtl/kept.vhd', 'kept disk\n');
      writeDisk('rtl/merged.vhd', 'merged disk\n');
      stageContents({ 'rtl/kept.vhd': 'kept gen\n', 'rtl/merged.vhd': 'merged gen\n' });
      jest.spyOn(StagingPanel, 'show').mockResolvedValue({
        confirmed: true,
        mergedPaths: ['rtl/merged.vhd'],
        actions: { 'rtl/kept.vhd': 'keep', 'rtl/merged.vhd': 'overwrite' },
      });

      await run();

      expect(fs.readFileSync(path.join(tmpDir, 'rtl/kept.vhd'), 'utf8')).toBe('kept disk\n');
      expect(fs.readFileSync(path.join(tmpDir, 'rtl/merged.vhd'), 'utf8')).toBe('merged disk\n');
      expect(fs.existsSync(baselinePath('rtl/kept.vhd'))).toBe(false);
      expect(fs.existsSync(baselinePath('rtl/merged.vhd'))).toBe(false);
    });

    it('does not fail generation when a baseline cannot be written', async () => {
      // A file where the baseline directory should be makes mkdir fail.
      writeDisk('.ipcraft', 'not a directory');
      stageContents({ 'rtl/new.vhd': 'new\n' });
      jest.spyOn(StagingPanel, 'show').mockResolvedValue({
        confirmed: true,
        mergedPaths: [],
        actions: {},
      });

      await expect(run()).resolves.toEqual({ success: true, ipCoreName: 'preview_endian' });
      expect(fs.readFileSync(path.join(tmpDir, 'rtl/new.vhd'), 'utf8')).toBe('new\n');
    });
  });
});
