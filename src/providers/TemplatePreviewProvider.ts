import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';
import { ResourceRoots } from '../services/ResourceRoots';

export const TEMPLATE_PREVIEW_SCHEME = 'ipcraft-j2-preview';

/**
 * Virtual document provider that renders a Nunjucks .j2 template against an
 * IP core YAML context and serves the result as a read-only document.
 *
 * URI format:
 *   ipcraft-j2-preview:/<rendered-filename>?t=<encoded-template-path>&ip=<encoded-ip-path>
 */
export class TemplatePreviewProvider implements vscode.TextDocumentContentProvider {
  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private readonly logger: Logger;
  private readonly context: vscode.ExtensionContext;
  private readonly resourceRoots: ResourceRoots;

  constructor(logger: Logger, context: vscode.ExtensionContext, resourceRoots: ResourceRoots) {
    this.logger = logger;
    this.context = context;
    this.resourceRoots = resourceRoots;
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const templatePath = params.get('t');
    const ipCorePath = params.get('ip');

    if (!templatePath || !ipCorePath) {
      return '-- Missing template or IP core path in URI';
    }

    try {
      const scaffolder = new IpCoreScaffolder(
        this.logger,
        new TemplateLoader(this.logger, this.resourceRoots.templatesDir),
        this.resourceRoots
      );

      const templateContext = await scaffolder.buildTemplateContextPublic(ipCorePath);

      // Search order: directory containing the template file first, then built-in templates
      const templateDir = path.dirname(templatePath);
      const templateName = path.basename(templatePath);
      const loader = new TemplateLoader(this.logger, [
        templateDir,
        this.resourceRoots.templatesDir,
      ]);

      return loader.render(templateName, templateContext);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('Template preview render failed', err as Error);
      return `-- Render error: ${msg}`;
    }
  }

  /** Fire change event to trigger a refresh of all open preview documents. */
  refresh(previewUri: vscode.Uri): void {
    this._onDidChange.fire(previewUri);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  /**
   * Build the virtual document URI for a given template file / IP core pair.
   * The filename in the URI path is cosmetic — it determines syntax highlighting
   * in the editor (e.g. `top.vhd` gets VHDL highlighting).
   */
  static buildUri(templatePath: string, ipCorePath: string): vscode.Uri {
    // Infer an output filename for syntax highlighting: strip the trailing .j2
    const baseName = path.basename(templatePath).replace(/\.j2$/, '');
    return vscode.Uri.from({
      scheme: TEMPLATE_PREVIEW_SCHEME,
      path: `/${baseName}`,
      query: `t=${encodeURIComponent(templatePath)}&ip=${encodeURIComponent(ipCorePath)}`,
    });
  }
}
