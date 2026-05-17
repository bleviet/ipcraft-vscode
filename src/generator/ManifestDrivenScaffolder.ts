import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from './TemplateLoader';
import { generateComponentXml, generateCustomBusDefs } from './VivadoComponentXmlGenerator';
import type { ResolvedManifest } from './templateManifest';
import type { BusDefinitions, GenerateOptions, GenerateResult, IpCoreData } from './types';

// Maps GenerateOptions flags to manifest group names.
// Explicit option values override manifest defaults; undefined means use the manifest default.
function resolveActiveGroups(manifest: ResolvedManifest, options: GenerateOptions): Set<string> {
  const active = new Map<string, boolean>(
    Object.entries(manifest.groups).map(([k, v]) => [k, v.enabled])
  );

  if (options.includeVhdl !== undefined) {
    active.set('rtl', options.includeVhdl);
  }
  if (options.includeRegs !== undefined) {
    active.set('regs', options.includeRegs);
  }
  if (options.includeTestbench !== undefined) {
    active.set('testbench', options.includeTestbench);
  }
  if (options.includeVivadoProject !== undefined) {
    active.set('vivado-project', options.includeVivadoProject);
  }
  if (options.includeQuartusProject !== undefined) {
    active.set('quartus-project', options.includeQuartusProject);
  }

  if (options.vendor !== undefined) {
    const v = options.vendor;
    active.set('altera', v === 'altera' || v === 'both');
    active.set('xilinx', v === 'xilinx' || v === 'both');
  }

  return new Set([...active.entries()].filter(([, enabled]) => enabled).map(([group]) => group));
}

// Evaluate a Jinja2 when-expression. Absent means always include.
function evaluateWhen(
  when: string | undefined,
  templateLoader: TemplateLoader,
  context: Record<string, unknown>
): boolean {
  if (!when) {
    return true;
  }
  const rendered = templateLoader.renderString(when, context).trim().toLowerCase();
  return rendered !== '' && rendered !== 'false' && rendered !== '0' && rendered !== 'none';
}

// Collect RTL paths from the accumulated files map, prefixed with "../" so they
// are correct relative to the xilinx/ or altera/ sub-directory where TCL lives.
function collectRtlFilesFromMap(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => f.startsWith('rtl/'))
    .map((f) => `../${f}`);
}

function quartusDeviceFamily(device: string): string {
  const d = device.toUpperCase();
  if (d.startsWith('5C')) {
    return 'Cyclone V';
  }
  if (d.startsWith('10CX')) {
    return 'Cyclone 10 LP';
  }
  if (d.startsWith('10M')) {
    return 'MAX 10';
  }
  if (d.startsWith('EP4CGX')) {
    return 'Cyclone IV GX';
  }
  if (d.startsWith('EP4C')) {
    return 'Cyclone IV E';
  }
  if (d.startsWith('EP3C')) {
    return 'Cyclone III';
  }
  if (d.startsWith('5AGZ')) {
    return 'Arria V GZ';
  }
  if (d.startsWith('5A')) {
    return 'Arria V';
  }
  if (d.startsWith('EP5S')) {
    return 'Stratix V';
  }
  if (d.startsWith('EP4S')) {
    return 'Stratix IV';
  }
  return 'Cyclone V';
}

export class ManifestDrivenScaffolder {
  constructor(
    private readonly logger: Logger,
    private readonly templateLoader: TemplateLoader,
    private readonly manifest: ResolvedManifest,
    private readonly busDefinitions: BusDefinitions
  ) {}

  async generate(
    ipCoreData: IpCoreData,
    context: Record<string, unknown>,
    options: GenerateOptions,
    outputDir: string,
    inputPath: string,
    protectedPaths: Set<string>
  ): Promise<GenerateResult> {
    void inputPath; // reserved for fileSets RTL fallback in a future stage
    try {
      const activeGroups = resolveActiveGroups(this.manifest, options);

      const enrichedContext: Record<string, unknown> = { ...context };
      if (options.targetPart) {
        enrichedContext.target_part = options.targetPart;
      }
      if (options.quartusDevice) {
        enrichedContext.target_device = options.quartusDevice;
        enrichedContext.device_family = quartusDeviceFamily(options.quartusDevice);
      }

      const files: Record<string, string> = {};

      for (const output of this.manifest.outputs) {
        if (output.group !== undefined && !activeGroups.has(output.group)) {
          continue;
        }

        if (!evaluateWhen(output.when, this.templateLoader, enrichedContext)) {
          continue;
        }

        const resolvedPath = this.templateLoader.renderString(output.path, enrichedContext).trim();

        const generator = output.generator ?? 'nunjucks';

        if (generator === 'component-xml') {
          const rtlFiles = collectRtlFilesFromMap(files);
          const xguiEntry = Object.keys(files).find(
            (f) => f.startsWith('xilinx/xgui/') && f.endsWith('.tcl')
          );
          const xguiFile = xguiEntry?.replace(/^xilinx\//, '');

          files[resolvedPath] = generateComponentXml(ipCoreData, this.busDefinitions, {
            rtlFiles,
            xguiFile,
          });

          // Custom bus definition files (e.g. custom AXI variants) are generated
          // as siblings in xilinx/ alongside component.xml.
          const customBusDefs = generateCustomBusDefs(ipCoreData, this.busDefinitions);
          for (const [relPath, content] of Object.entries(customBusDefs)) {
            files[`xilinx/${relPath}`] = content;
          }
        } else {
          if (!output.template) {
            this.logger.error(
              `Manifest output "${resolvedPath}" has generator "nunjucks" but no template field`
            );
            continue;
          }

          const templateName = this.templateLoader
            .renderString(output.template, enrichedContext)
            .trim();

          const renderContext = this.buildRenderContext(
            enrichedContext,
            output.group,
            files,
            String(context.entity_name ?? 'ip_core')
          );

          files[resolvedPath] = this.templateLoader.render(templateName, renderContext);
        }
      }

      const written: Record<string, string> = {};
      await Promise.all(
        Object.entries(files).map(async ([relativePath, content]) => {
          if (protectedPaths.has(relativePath)) {
            this.logger.info(`Skipping managed:false file: ${relativePath}`);
            return;
          }
          const fullPath = path.join(outputDir, relativePath);
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, content, 'utf8');
          written[relativePath] = fullPath;
        })
      );

      this.logger.info('Manifest-driven generation complete', {
        count: Object.keys(written).length,
        outputDir,
      });

      return {
        success: true,
        files: written,
        count: Object.keys(written).length,
        busType: String(context.bus_type ?? ''),
      };
    } catch (error) {
      this.logger.error('Manifest-driven generation failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Inject extra context fields needed by vivado-project and quartus-project templates.
  // RTL files are computed from already-accumulated outputs, so project group entries
  // must appear after rtl/regs entries in the manifest.
  private buildRenderContext(
    base: Record<string, unknown>,
    group: string | undefined,
    accumulatedFiles: Record<string, string>,
    entityName: string
  ): Record<string, unknown> {
    if (group === 'vivado-project') {
      return {
        ...base,
        rtl_files: collectRtlFilesFromMap(accumulatedFiles),
        xdc_file: `${entityName}_ooc.xdc`,
      };
    }
    if (group === 'quartus-project') {
      return {
        ...base,
        rtl_files: collectRtlFilesFromMap(accumulatedFiles),
        sdc_file: `${entityName}.sdc`,
      };
    }
    return base;
  }
}
