/* eslint-disable */
/**
 * Stage 2 integration tests — custom template directory shadowing.
 *
 * These tests write real files to a temp directory and verify the complete
 * pipeline: manifest on disk → ManifestLoader.find() → TemplateLoader with
 * custom dir first → ManifestDrivenScaffolder renders custom content, not built-in.
 *
 * fs/promises.mkdir and fs/promises.writeFile are mocked so output files are
 * captured rather than written to disk. fs/promises.readFile is left real so
 * ManifestLoader can read the manifest. Nunjucks FileSystemLoader uses the
 * synchronous fs.readFileSync, so template files in real temp dirs are loaded
 * correctly regardless of the async mock.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as fsp from 'fs/promises';
import { ManifestLoader } from '../../../generator/ManifestLoader';
import { ManifestDrivenScaffolder } from '../../../generator/ManifestDrivenScaffolder';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { Logger } from '../../../utils/Logger';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
});

const BUILTIN_PATH = path.resolve(__dirname, '../../../generator/templates');

const baseContext: Record<string, unknown> = {
  entity_name: 'my_ip',
  bus_type: 'axil',
  has_memory_mapped_slave: true,
  registers: [],
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
  memmap_relpath: '../my_ip.mm.yml',
  vendor: 'acme.com',
  library: 'ip',
  version: '2.0.0',
  description: 'Integration test core',
  author: 'acme.com',
  display_name: 'My Ip',
};

const ipCoreData = {
  vlnv: { vendor: 'acme.com', library: 'ip', name: 'my_ip', version: '2.0.0' },
  bus_interfaces: [],
} as any;

// Returns a map of { relativePath: renderedContent } from captured writeFile calls.
function capturedWrites(): Map<string, string> {
  const writes = new Map<string, string>();
  const calls = (fsp.writeFile as unknown as jest.Mock).mock.calls;
  for (const [fullPath, content] of calls) {
    // Extract relative path from the last two path segments for easier assertions
    writes.set(path.basename(fullPath as string), content as string);
    // Also store the full path for cases where filename alone is ambiguous
    writes.set(fullPath as string, content as string);
  }
  return writes;
}

describe('Custom template directory — end-to-end shadowing', () => {
  const logger = new Logger('test') as any;
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-stage2-'));
    // Create ./templates sub-directory
    fs.mkdirSync(path.join(projectDir, 'templates'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function writeManifest(extraTemplateDir = true): void {
    const templateDirs = extraTemplateDir
      ? ['./templates', 'ipcraft://builtin']
      : ['ipcraft://builtin'];
    const manifest = {
      version: '1.0',
      templateDirs,
      groups: { rtl: { enabled: true } },
      outputs: [
        { template: 'top.vhdl.j2', path: 'rtl/{{ entity_name }}.vhd', group: 'rtl' },
        { template: 'core.vhdl.j2', path: 'rtl/{{ entity_name }}_core.vhd', group: 'rtl' },
      ],
    };
    fs.writeFileSync(
      path.join(projectDir, 'ipcraft.templates.yml'),
      `version: '${manifest.version}'\ntemplateDir` +
        `s:\n${manifest.templateDirs.map((d) => `  - ${d}`).join('\n')}\n` +
        `groups:\n  rtl:\n    enabled: true\n` +
        `outputs:\n` +
        manifest.outputs
          .map((o) => `  - template: ${o.template}\n    path: '${o.path}'\n    group: ${o.group}`)
          .join('\n')
    );
  }

  async function runScaffolder(): Promise<void> {
    const ipCorePath = path.join(projectDir, 'core.ip.yml');
    const manifest = await ManifestLoader.find(ipCorePath, BUILTIN_PATH);
    if (!manifest) throw new Error('Manifest not found');

    const templateLoader = new TemplateLoader(logger, manifest.templateDirs);
    const scaffolder = new ManifestDrivenScaffolder(logger, templateLoader, manifest, {});
    await scaffolder.generate(
      ipCoreData,
      baseContext,
      { includeVhdl: true },
      path.join(projectDir, 'output'),
      ipCorePath,
      new Set()
    );
  }

  it('ManifestLoader.find() locates the manifest adjacent to the .ip.yml', async () => {
    writeManifest();
    const ipCorePath = path.join(projectDir, 'core.ip.yml');
    const manifest = await ManifestLoader.find(ipCorePath, BUILTIN_PATH);

    expect(manifest).not.toBeNull();
    expect(manifest!.outputs).toHaveLength(2);
  });

  it('ManifestLoader.find() returns null when no manifest is present', async () => {
    // No manifest written — only core.ip.yml present
    const ipCorePath = path.join(projectDir, 'core.ip.yml');
    const manifest = await ManifestLoader.find(ipCorePath, BUILTIN_PATH);

    expect(manifest).toBeNull();
  });

  it('resolves templateDirs relative to the manifest directory', async () => {
    writeManifest();
    const ipCorePath = path.join(projectDir, 'core.ip.yml');
    const manifest = await ManifestLoader.find(ipCorePath, BUILTIN_PATH);

    expect(manifest!.templateDirs[0]).toBe(path.join(projectDir, 'templates'));
    expect(manifest!.templateDirs[1]).toBe(BUILTIN_PATH);
  });

  it('uses a custom template when it shadows a built-in', async () => {
    writeManifest();
    // Drop a custom top.vhdl.j2 with a distinctive marker
    fs.writeFileSync(
      path.join(projectDir, 'templates', 'top.vhdl.j2'),
      '-- CUSTOM TOP for {{ entity_name }}'
    );

    await runScaffolder();

    const writes = capturedWrites();
    const topContent = [...writes.entries()].find(([k]) => k.endsWith('my_ip.vhd'))?.[1];
    expect(topContent).toBeDefined();
    expect(topContent).toContain('CUSTOM TOP for my_ip');
    // Must not contain the built-in header
    expect(topContent).not.toContain('Generated by ipcraft');
  });

  it('falls back to the built-in when the custom dir does not have the template', async () => {
    writeManifest();
    // templates/ dir is empty — core.vhdl.j2 must come from built-in
    // Also put a custom top.vhdl.j2 to confirm partial shadowing
    fs.writeFileSync(
      path.join(projectDir, 'templates', 'top.vhdl.j2'),
      '-- CUSTOM TOP for {{ entity_name }}'
    );

    await runScaffolder();

    const writes = capturedWrites();

    // top.vhd uses custom template
    const topContent = [...writes.entries()].find(([k]) => k.endsWith('my_ip.vhd'))?.[1];
    expect(topContent).toContain('CUSTOM TOP for my_ip');

    // _core.vhd falls back to built-in (contains entity declaration)
    const coreContent = [...writes.entries()].find(([k]) => k.endsWith('my_ip_core.vhd'))?.[1];
    expect(coreContent).toBeDefined();
    expect(coreContent).toContain('entity my_ip_core is');
  });

  it('without a custom dir all templates render from built-ins', async () => {
    writeManifest(false); // templateDirs: [ipcraft://builtin] only

    await runScaffolder();

    const writes = capturedWrites();
    const topContent = [...writes.entries()].find(([k]) => k.endsWith('my_ip.vhd'))?.[1];
    expect(topContent).toBeDefined();
    expect(topContent).toContain('entity my_ip is');
    expect(topContent).not.toContain('CUSTOM');
  });
});
