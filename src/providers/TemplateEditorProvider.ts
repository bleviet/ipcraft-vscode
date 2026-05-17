import * as vscode from 'vscode';
import * as path from 'path';
import * as fsp from 'fs/promises';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { ManifestLoader } from '../generator/ManifestLoader';
import { TemplateLoader } from '../generator/TemplateLoader';
import type { ManifestOutput, WebviewMessage } from '../webview/templateEditor/types';
import type { TemplateManifest } from '../generator/templateManifest';

// Full manifest matching built-in hardcoded behavior — used for "Initialise manifest".
const DEFAULT_MANIFEST_RAW: TemplateManifest = {
  version: '1.0',
  templateDirs: ['./templates', 'ipcraft://builtin'],
  groups: {
    rtl: { enabled: true },
    regs: { enabled: true },
    testbench: { enabled: true },
    altera: { enabled: false },
    xilinx: { enabled: false },
    'vivado-project': { enabled: false },
    'quartus-project': { enabled: false },
  },
  outputs: [
    // RTL
    { template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' },
    {
      template: 'package.vhdl.j2',
      path: 'rtl/{{ entity_name }}_pkg.vhd',
      group: 'rtl',
      when: '{{ has_memory_mapped_slave }}',
    },
    {
      template: 'core.vhdl.j2',
      path: 'rtl/{{ entity_name }}_core.vhd',
      group: 'rtl',
      when: '{{ has_memory_mapped_slave }}',
    },
    {
      template: 'bus_{{ bus_type }}.vhdl.j2',
      path: 'rtl/{{ entity_name }}_{{ bus_type }}.vhd',
      group: 'rtl',
      when: '{{ has_memory_mapped_slave }}',
    },
    // Registers
    { template: 'register_file.vhdl.j2', path: 'rtl/{{ entity_name }}_regs.vhd', group: 'regs' },
    // Testbench
    { template: 'mm_loader.py.j2', path: 'tb/mm_loader.py', group: 'testbench' },
    {
      template: 'cocotb_test.py.j2',
      path: 'tb/{{ entity_name }}_test.py',
      group: 'testbench',
    },
    { template: 'cocotb_conftest.py.j2', path: 'tb/conftest.py', group: 'testbench' },
    {
      template: 'cocotb_pytest.py.j2',
      path: 'tb/test_{{ entity_name }}_sim.py',
      group: 'testbench',
    },
    { template: 'cocotb_makefile.j2', path: 'tb/Makefile', group: 'testbench' },
    {
      template: 'vscode_settings.json.j2',
      path: '.vscode/settings.json',
      group: 'testbench',
    },
    // Altera
    {
      template: 'altera_hw_tcl.j2',
      path: 'altera/{{ entity_name }}_hw.tcl',
      group: 'altera',
    },
    // Xilinx
    {
      template: 'amd_xgui.j2',
      path: "xilinx/xgui/{{ entity_name }}_v{{ version | replace('.', '_') }}.tcl",
      group: 'xilinx',
    },
    { generator: 'component-xml', path: 'xilinx/component.xml', group: 'xilinx' },
    // Vivado project
    {
      template: 'vivado_project.tcl.j2',
      path: 'xilinx/{{ entity_name }}_project.tcl',
      group: 'vivado-project',
    },
    {
      template: 'vivado_ooc.xdc.j2',
      path: 'xilinx/{{ entity_name }}_ooc.xdc',
      group: 'vivado-project',
    },
    {
      template: 'vivado_run_ooc.tcl.j2',
      path: 'xilinx/{{ entity_name }}_run_ooc.tcl',
      group: 'vivado-project',
    },
    {
      template: 'vivado_run_xpr.tcl.j2',
      path: 'xilinx/{{ entity_name }}_run_xpr.tcl',
      group: 'vivado-project',
    },
    // Quartus project
    {
      template: 'quartus_project.tcl.j2',
      path: 'altera/{{ entity_name }}_project.tcl',
      group: 'quartus-project',
    },
    {
      template: 'quartus_sdc.j2',
      path: 'altera/{{ entity_name }}.sdc',
      group: 'quartus-project',
    },
  ],
};

export class TemplateEditorProvider {
  private readonly logger = new Logger('TemplateEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly builtinTemplatesPath: string;
  private previewContext: Record<string, unknown> = {};
  private previewLoader: TemplateLoader | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.htmlGenerator = new HtmlGenerator(context);
    this.builtinTemplatesPath = path.join(context.extensionPath, 'dist', 'templates');
  }

  async open(uri?: vscode.Uri): Promise<void> {
    const ipCorePath =
      uri?.fsPath ??
      (vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('.ip.yml') ||
      vscode.window.activeTextEditor?.document.uri.fsPath.endsWith('.ip.yaml')
        ? vscode.window.activeTextEditor?.document.uri.fsPath
        : undefined);

    const panel = vscode.window.createWebviewPanel(
      'ipcraft.templateEditor',
      'Template Editor',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
      }
    );

    panel.webview.html = this.htmlGenerator.generateTemplateEditorHtml(panel.webview);

    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          await this.sendInit(panel, ipCorePath);
          break;
        case 'initManifest':
          await this.handleInitManifest(panel, ipCorePath);
          break;
        case 'renderPreview':
          this.handleRenderPreview(panel, message.source);
          break;
        case 'copyBuiltin':
          await this.handleCopyBuiltin(panel, message.templateName, ipCorePath);
          break;
        case 'saveTemplate':
          await this.handleSaveTemplate(message.templateName, message.content, ipCorePath);
          break;
        case 'saveManifest':
          await this.handleSaveManifest(message.groups, message.outputs, ipCorePath);
          break;
      }
    });
  }

  private async sendInit(panel: vscode.WebviewPanel, ipCorePath?: string): Promise<void> {
    const builtinTemplates = await this.loadTemplatesFromDir(this.builtinTemplatesPath);

    let manifest = null;
    let customTemplates: Record<string, string> = {};
    let manifestPath: string | null = null;
    let customTemplateDir: string | null = null;

    if (ipCorePath) {
      manifest = await ManifestLoader.find(ipCorePath, this.builtinTemplatesPath);
      if (manifest) {
        manifestPath = path.join(path.dirname(ipCorePath), 'ipcraft.templates.yml');
        const customDir = manifest.templateDirs.find((d) => d !== this.builtinTemplatesPath);
        if (customDir) {
          customTemplateDir = customDir;
          customTemplates = await this.loadTemplatesFromDir(customDir);
        }
      }
    }

    this.previewContext = this.buildSampleContext(ipCorePath);
    this.previewLoader = new TemplateLoader(this.logger, this.builtinTemplatesPath);

    void panel.webview.postMessage({
      type: 'init',
      builtinTemplates,
      customTemplates,
      manifest,
      context: this.previewContext,
      manifestPath,
      customTemplateDir,
    });
  }

  private handleRenderPreview(panel: vscode.WebviewPanel, source: string): void {
    try {
      const preview = this.previewLoader
        ? this.previewLoader.renderString(source, this.previewContext)
        : '';
      void panel.webview.postMessage({ type: 'previewResult', preview, error: null });
    } catch (e) {
      void panel.webview.postMessage({
        type: 'previewResult',
        preview: '',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async handleInitManifest(panel: vscode.WebviewPanel, ipCorePath?: string): Promise<void> {
    if (!ipCorePath) {
      void panel.webview.postMessage({
        type: 'error',
        message: 'Open a .ip.yml file first so IPCraft knows where to create the manifest.',
      });
      return;
    }

    const manifestPath = path.join(path.dirname(ipCorePath), 'ipcraft.templates.yml');
    try {
      const content = yaml.dump(DEFAULT_MANIFEST_RAW, { indent: 2, lineWidth: 120 });
      await fsp.writeFile(manifestPath, content, 'utf8');
      this.logger.info(`Initialised manifest: ${manifestPath}`);
      // Re-send init so the webview gets the newly resolved manifest
      await this.sendInit(panel, ipCorePath);
    } catch (e) {
      this.logger.error('Failed to initialise manifest', e as Error);
      void panel.webview.postMessage({
        type: 'error',
        message: `Failed to create manifest: ${String(e)}`,
      });
    }
  }

  private async loadTemplatesFromDir(dir: string): Promise<Record<string, string>> {
    const templates: Record<string, string> = {};
    try {
      const files = await fsp.readdir(dir);
      await Promise.all(
        files
          .filter((f) => f.endsWith('.j2'))
          .map(async (f) => {
            templates[f] = await fsp.readFile(path.join(dir, f), 'utf8');
          })
      );
    } catch {
      // dir may not exist yet
    }
    return templates;
  }

  private async handleCopyBuiltin(
    panel: vscode.WebviewPanel,
    templateName: string,
    ipCorePath?: string
  ): Promise<void> {
    const srcPath = path.join(this.builtinTemplatesPath, templateName);
    try {
      const content = await fsp.readFile(srcPath, 'utf8');
      const customDir = await this.resolveCustomDir(ipCorePath);
      if (!customDir) {
        void panel.webview.postMessage({
          type: 'error',
          message: 'Open a .ip.yml file first so IPCraft knows where to save the template.',
        });
        return;
      }
      await fsp.mkdir(customDir, { recursive: true });
      await fsp.writeFile(path.join(customDir, templateName), content, 'utf8');
      this.logger.info(`Copied builtin template to: ${path.join(customDir, templateName)}`);
      void panel.webview.postMessage({ type: 'copiedBuiltin', templateName, content });
    } catch (e) {
      this.logger.error('Failed to copy builtin template', e as Error);
      void panel.webview.postMessage({
        type: 'error',
        message: `Failed to copy template: ${String(e)}`,
      });
    }
  }

  private async handleSaveTemplate(
    templateName: string,
    content: string,
    ipCorePath?: string
  ): Promise<void> {
    const customDir = await this.resolveCustomDir(ipCorePath);
    if (!customDir) {
      vscode.window.showErrorMessage('Cannot save template: open a .ip.yml file first.');
      return;
    }
    await fsp.mkdir(customDir, { recursive: true });
    await fsp.writeFile(path.join(customDir, templateName), content, 'utf8');
    this.logger.info(`Saved template: ${path.join(customDir, templateName)}`);
  }

  // Merges groups/outputs into the existing on-disk YAML, preserving templateDirs and version.
  private async handleSaveManifest(
    groups: Record<string, { enabled: boolean }>,
    outputs: ManifestOutput[],
    ipCorePath?: string
  ): Promise<void> {
    if (!ipCorePath) {
      vscode.window.showErrorMessage('Cannot save manifest: open a .ip.yml file first.');
      return;
    }

    const manifestPath = path.join(path.dirname(ipCorePath), 'ipcraft.templates.yml');

    let existing: Record<string, unknown> = {};
    try {
      const raw = yaml.load(await fsp.readFile(manifestPath, 'utf8'));
      if (raw && typeof raw === 'object') {
        existing = raw as Record<string, unknown>;
      }
    } catch {
      // No manifest yet — start from defaults
      existing = {
        version: '1.0',
        templateDirs: ['./templates', 'ipcraft://builtin'],
      };
    }

    const merged = { ...existing, groups, outputs };
    await fsp.writeFile(manifestPath, yaml.dump(merged, { indent: 2, lineWidth: 120 }), 'utf8');
    this.logger.info(`Saved manifest: ${manifestPath}`);
  }

  private async resolveCustomDir(ipCorePath?: string): Promise<string | null> {
    if (!ipCorePath) {
      return null;
    }
    const manifest = await ManifestLoader.find(ipCorePath, this.builtinTemplatesPath);
    if (manifest) {
      const customDir = manifest.templateDirs.find((d) => d !== this.builtinTemplatesPath);
      if (customDir) {
        return customDir;
      }
    }
    return path.join(path.dirname(ipCorePath), 'templates');
  }

  private buildSampleContext(ipCorePath?: string): Record<string, unknown> {
    const entityName = ipCorePath ? path.basename(ipCorePath).replace(/\.ip\.ya?ml$/, '') : 'my_ip';

    return {
      entity_name: entityName,
      bus_type: 'axil',
      has_memory_mapped_slave: true,
      registers: [
        { name: 'CTRL', offset: 0, access: 'read-write', fields: [] },
        { name: 'STATUS', offset: 4, access: 'read-only', fields: [] },
      ],
      sw_registers: [],
      hw_registers: [],
      generics: [],
      user_ports: [],
      interrupt_ports: [],
      bus_ports: [],
      secondary_bus_ports: [],
      expanded_bus_interfaces: [],
      bus_prefix: 's_axi',
      data_width: 32,
      addr_width: 8,
      reg_width: 4,
      memory_maps: [],
      clock_port: 'clk',
      reset_port: 'rst',
      reset_active_high: true,
      clocks_with_period: [],
      memmap_relpath: `../${entityName}.mm.yml`,
      vendor: 'acme.com',
      library: 'ip',
      version: '1.0.0',
      description: 'Sample IP core',
      author: 'acme.com',
      display_name: entityName
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    };
  }
}
