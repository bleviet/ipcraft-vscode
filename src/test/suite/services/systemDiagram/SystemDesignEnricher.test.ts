import * as vscode from 'vscode';
import { readQsys } from '../../../../parser/system/QsysReader';
import { SystemDesignEnricher } from '../../../../services/systemDiagram/SystemDesignEnricher';
import { readFileSync } from 'fs';
import * as path from 'path';
import { bdGraph, IP_YML } from './enrichment/definitionFixtures';

const PULSE_VHDL = `
entity Pulse_Gen is
  port (
    clk : in std_logic;
    q   : out std_logic_vector(7 downto 0)
  );
end entity;
`;
const DESIGN = '/ws/design.tcl';

const uri = (fsPath: string) =>
  ({ fsPath, toString: () => `file://${fsPath}` }) as unknown as vscode.Uri;

type Handler = (uri: vscode.Uri) => void;

function setup(files: Record<string, string>, sizes: Record<string, number> = {}) {
  const handlers: Record<string, Handler[]> = {};
  const watchers: { dispose: jest.Mock }[] = [];
  const workspace = vscode.workspace as unknown as {
    isTrusted: boolean;
    findFiles: jest.Mock;
    createFileSystemWatcher: jest.Mock;
    asRelativePath: jest.Mock;
    getConfiguration: jest.Mock;
    onDidChangeConfiguration: jest.Mock;
    fs: { readFile: jest.Mock; stat: jest.Mock };
  };
  workspace.isTrusted = true;
  workspace.getConfiguration.mockReturnValue({ get: () => undefined });
  workspace.onDidChangeConfiguration.mockReturnValue({ dispose: jest.fn() });
  workspace.asRelativePath.mockImplementation((u: vscode.Uri) => u.fsPath.replace('/ws/', ''));
  const excluded = new Set<string>();
  workspace.findFiles.mockImplementation((glob: string | { base: string; pattern: string }) => {
    if (typeof glob !== 'string') {
      // A single-path visibility check (files.exclude applies).
      const path = `${glob.base}/${glob.pattern}`;
      return Promise.resolve(excluded.has(path) || !(path in files) ? [] : [uri(path)]);
    }
    // `**/*.{a,b}` or `**/*.ext`: keep the files with one of the extensions.
    const extensions = glob
      .replace(/^\*\*\/\*\./, '')
      .replace(/^\{|\}$/g, '')
      .split(',');
    return Promise.resolve(
      Object.keys(files)
        .filter((file) => extensions.some((extension) => file.endsWith(`.${extension}`)))
        .map(uri)
    );
  });
  workspace.fs.readFile.mockImplementation((u: vscode.Uri) =>
    files[u.fsPath] === undefined
      ? Promise.reject(new Error('missing'))
      : Promise.resolve(new TextEncoder().encode(files[u.fsPath]))
  );
  workspace.fs.stat.mockImplementation((u: vscode.Uri) =>
    Promise.resolve({ size: sizes[u.fsPath] ?? 100 })
  );
  workspace.createFileSystemWatcher.mockImplementation((glob: string) => {
    const register = (kind: string) =>
      jest.fn((handler: Handler) => {
        (handlers[`${glob}:${kind}`] ??= []).push(handler);
        return { dispose: jest.fn() };
      });
    const watcher = {
      onDidCreate: register('create'),
      onDidChange: register('change'),
      onDidDelete: register('delete'),
      dispose: jest.fn(),
    };
    watchers.push(watcher);
    return watcher;
  });
  const fire = async (glob: string, kind: string, path: string) => {
    for (const handler of handlers[`${glob}:${kind}`]) {
      handler(uri(path));
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { workspace, handlers, watchers, fire, files, excluded };
}

const IP_GLOB = '**/*.ip.yml';
const ipSearches = (findFiles: jest.Mock) =>
  (findFiles.mock.calls as string[][]).filter((call) => call[0] === IP_GLOB).length;
const HDL_GLOB = '**/*.{vhd,vhdl,v,sv}';

describe('SystemDesignEnricher', () => {
  it('reads nothing in an untrusted workspace and adds one info diagnostic', async () => {
    const { workspace } = setup({ '/ws/my_core.ip.yml': IP_YML });
    workspace.isTrusted = false;
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(result.diagnostics.at(-1)).toEqual({
      severity: 'info',
      message: 'IP definitions are not read in untrusted workspaces.',
    });
    expect(result.instances['/my_core_0'].definition).toBeUndefined();
    expect(workspace.findFiles).not.toHaveBeenCalled();
    expect(workspace.fs.readFile).not.toHaveBeenCalled();
  });

  it('enriches an ip instance from the matching .ip.yml and skips unparsable files', async () => {
    setup({ '/ws/my_core.ip.yml': IP_YML, '/ws/broken.ip.yml': 'vlnv: [' });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(result.instances['/my_core_0'].definition).toEqual({
      kind: 'ip.yml',
      file: '/ws/my_core.ip.yml',
      uri: 'file:///ws/my_core.ip.yml',
      displayName: 'my_core.ip.yml',
    });
    expect(result.instances['/my_core_0'].pins.find((p) => p.name === 'flag')?.definedBy).toBe(
      'ip.yml'
    );
    expect(result.instances['/other_0'].definition).toBeUndefined();
  });

  it('enriches a module instance from the HDL file that declares the entity', async () => {
    setup({ '/ws/rtl/pulse_gen.vhd': PULSE_VHDL, '/ws/rtl/other.vhd': 'entity other is end;' });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    const instance = result.instances['/pulse_0'];
    expect(instance.definition).toMatchObject({ kind: 'hdl', displayName: 'rtl/pulse_gen.vhd' });
    expect(instance.pins.map((p) => p.name)).toEqual(expect.arrayContaining(['clk', 'q']));
    expect(instance.pins.find((p) => p.name === 'q')).toMatchObject({
      direction: 'out',
      width: { from: 7, to: 0 },
      definedBy: 'hdl',
    });
  });

  it('passes the exclude glob and drops generated and dependency directories in code', async () => {
    const { workspace } = setup({
      '/ws/node_modules/x/my_core.ip.yml': IP_YML,
      '/ws/proj.gen/my_core.ip.yml': IP_YML,
      '/ws/ip/my_core.ip.yml': IP_YML,
    });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect((workspace.findFiles.mock.calls as unknown[][])[0][1]).toEqual(
      expect.stringContaining('**/node_modules/**')
    );
    expect(result.instances['/my_core_0'].definition?.file).toBe('/ws/ip/my_core.ip.yml');
  });

  it('skips HDL files larger than 1 MiB', async () => {
    setup({ '/ws/rtl/pulse_gen.vhd': PULSE_VHDL }, { '/ws/rtl/pulse_gen.vhd': 1024 * 1024 + 1 });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(result.instances['/pulse_0'].definition).toBeUndefined();
  });

  it('reads HDL files with at most 8 concurrent reads', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i += 1) {
      files[`/ws/rtl/f${i}.vhd`] = `entity e${i} is end;`;
    }
    const { workspace } = setup(files);
    let active = 0;
    let peak = 0;
    workspace.fs.readFile.mockImplementation(async (u: vscode.Uri) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return new TextEncoder().encode(files[u.fsPath]);
    });
    await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('builds the HDL index only when the graph has module instances', async () => {
    const { workspace } = setup({ '/ws/my_core.ip.yml': IP_YML });
    const graph = JSON.parse(JSON.stringify(bdGraph)) as typeof bdGraph;
    delete graph.instances['/pulse_0'];
    await new SystemDesignEnricher().enrich(graph, DESIGN);
    expect((workspace.findFiles.mock.calls as string[][]).map((call) => call[0])).toEqual([
      IP_GLOB,
    ]);
  });

  it('creates each watcher once, however often files change', async () => {
    const { workspace, fire } = setup({
      '/ws/my_core.ip.yml': IP_YML,
      '/ws/rtl/pulse_gen.vhd': PULSE_VHDL,
    });
    const enricher = new SystemDesignEnricher();
    await enricher.enrich(bdGraph, DESIGN);
    for (let i = 0; i < 3; i += 1) {
      await fire(IP_GLOB, 'change', '/ws/my_core.ip.yml');
      await fire(HDL_GLOB, 'change', '/ws/rtl/pulse_gen.vhd');
      await enricher.enrich(bdGraph, DESIGN);
    }
    const globs = (workspace.createFileSystemWatcher.mock.calls as string[][]).map((c) => c[0]);
    expect(globs.sort()).toEqual([HDL_GLOB, IP_GLOB].sort());
  });

  it('updates the index for the changed file only', async () => {
    const { workspace, fire, files } = setup({ '/ws/other/my_core.ip.yml': IP_YML });
    const enricher = new SystemDesignEnricher();
    const definitionFile = async () =>
      (await enricher.enrich(bdGraph, '/ws/proj/design.tcl')).instances['/my_core_0'].definition
        ?.file;
    expect(await definitionFile()).toBe('/ws/other/my_core.ip.yml');
    expect(ipSearches(workspace.findFiles)).toBe(1);

    // create: a closer file takes over
    files['/ws/proj/my_core.ip.yml'] = IP_YML;
    await fire(IP_GLOB, 'create', '/ws/proj/my_core.ip.yml');
    expect(await definitionFile()).toBe('/ws/proj/my_core.ip.yml');

    // change: the file no longer matches
    files['/ws/proj/my_core.ip.yml'] = IP_YML.replace('My_Core', 'Renamed');
    await fire(IP_GLOB, 'change', '/ws/proj/my_core.ip.yml');
    expect(await definitionFile()).toBe('/ws/other/my_core.ip.yml');

    // delete
    delete files['/ws/other/my_core.ip.yml'];
    await fire(IP_GLOB, 'delete', '/ws/other/my_core.ip.yml');
    expect(await definitionFile()).toBeUndefined();
    expect(ipSearches(workspace.findFiles)).toBe(1);
  });

  it('updates the HDL index per file on create, change and delete', async () => {
    const { fire, files } = setup({ '/ws/rtl/other.vhd': 'entity other is end;' });
    const enricher = new SystemDesignEnricher();
    const hasDefinition = async () =>
      (await enricher.enrich(bdGraph, DESIGN)).instances['/pulse_0'].definition !== undefined;
    expect(await hasDefinition()).toBe(false);
    files['/ws/rtl/pulse_gen.vhd'] = PULSE_VHDL;
    await fire(HDL_GLOB, 'create', '/ws/rtl/pulse_gen.vhd');
    expect(await hasDefinition()).toBe(true);
    files['/ws/rtl/pulse_gen.vhd'] = 'entity renamed is end;';
    await fire(HDL_GLOB, 'change', '/ws/rtl/pulse_gen.vhd');
    expect(await hasDefinition()).toBe(false);
    files['/ws/rtl/pulse_gen.vhd'] = PULSE_VHDL;
    await fire(HDL_GLOB, 'change', '/ws/rtl/pulse_gen.vhd');
    expect(await hasDefinition()).toBe(true);
    delete files['/ws/rtl/pulse_gen.vhd'];
    await fire(HDL_GLOB, 'delete', '/ws/rtl/pulse_gen.vhd');
    expect(await hasDefinition()).toBe(false);
  });

  it('applies files.exclude to watcher events like the build does', async () => {
    const { fire, files, excluded } = setup({ '/ws/other/my_core.ip.yml': IP_YML });
    const enricher = new SystemDesignEnricher();
    const definitionFile = async () =>
      (await enricher.enrich(bdGraph, DESIGN)).instances['/my_core_0'].definition?.file;
    expect(await definitionFile()).toBe('/ws/other/my_core.ip.yml');
    files['/ws/hidden/my_core.ip.yml'] = IP_YML;
    excluded.add('/ws/hidden/my_core.ip.yml');
    await fire(IP_GLOB, 'create', '/ws/hidden/my_core.ip.yml');
    expect(await definitionFile()).toBe('/ws/other/my_core.ip.yml');
    // A file that becomes excluded leaves the index on its next change.
    excluded.add('/ws/other/my_core.ip.yml');
    await fire(IP_GLOB, 'change', '/ws/other/my_core.ip.yml');
    expect(await definitionFile()).toBeUndefined();
  });

  it('keeps processing watcher events after one update fails', async () => {
    const { workspace, fire, files } = setup({ '/ws/other/my_core.ip.yml': IP_YML });
    const enricher = new SystemDesignEnricher();
    await enricher.enrich(bdGraph, DESIGN);
    workspace.findFiles.mockRejectedValueOnce(new Error('search failed'));
    await fire(IP_GLOB, 'change', '/ws/other/my_core.ip.yml');
    files['/ws/proj/my_core.ip.yml'] = IP_YML;
    await fire(IP_GLOB, 'create', '/ws/proj/my_core.ip.yml');
    const result = await enricher.enrich(bdGraph, '/ws/proj/design.tcl');
    expect(result.instances['/my_core_0'].definition?.file).toBe('/ws/proj/my_core.ip.yml');
  });

  it('skips a file whose first parsed module is not the reference', async () => {
    setup({
      '/ws/rtl/two.sv':
        '(* keep *) module other (input clk);\nendmodule\nmodule pulse_gen (input clk);\nendmodule',
    });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(result.instances['/pulse_0'].definition).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toContain(
      'pulse_0: rtl/two.sv declares pulse_gen after another unit; its ports are not read.'
    );
  });

  it('retries an index build that rejected', async () => {
    const { workspace } = setup({ '/ws/my_core.ip.yml': IP_YML });
    const enricher = new SystemDesignEnricher();
    workspace.findFiles.mockRejectedValueOnce(new Error('search failed'));
    await expect(enricher.enrich(bdGraph, DESIGN)).rejects.toThrow('search failed');
    workspace.findFiles.mockImplementation(() => Promise.resolve([uri('/ws/my_core.ip.yml')]));
    const result = await enricher.enrich(bdGraph, DESIGN);
    expect(result.instances['/my_core_0'].definition?.file).toBe('/ws/my_core.ip.yml');
    // The retry reuses the watcher created for the first attempt.
    const ipWatchers = (workspace.createFileSystemWatcher.mock.calls as string[][]).filter(
      (call) => call[0] === IP_GLOB
    );
    expect(ipWatchers).toHaveLength(1);
  });

  it('reports a module that is not the first unit of its file', async () => {
    setup({ '/ws/rtl/many.vhd': 'entity first_unit is end;\nentity pulse_gen is end;' });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(result.instances['/pulse_0'].definition).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toContain(
      'pulse_0: rtl/many.vhd declares pulse_gen after another unit; its ports are not read.'
    );
  });

  it('indexes SystemVerilog modules declared with a lifetime keyword', async () => {
    setup({
      '/ws/rtl/pulse_gen.sv': 'module automatic pulse_gen (input clk, output q);\nendmodule',
    });
    const result = await new SystemDesignEnricher().enrich(bdGraph, DESIGN);
    expect(result.instances['/pulse_0'].definition).toMatchObject({ kind: 'hdl' });
    expect(result.instances['/pulse_0'].pins.map((p) => p.name)).toEqual(
      expect.arrayContaining(['clk', 'q'])
    );
  });

  it('disposes its watchers', async () => {
    const { watchers } = setup({ '/ws/my_core.ip.yml': IP_YML });
    const enricher = new SystemDesignEnricher();
    await enricher.enrich(bdGraph, DESIGN);
    enricher.dispose();
    expect(watchers.length).toBeGreaterThan(0);
    for (const watcher of watchers) {
      expect(watcher.dispose).toHaveBeenCalled();
    }
  });
});

describe('SystemDesignEnricher subsystems', () => {
  const fixture = (name: string) =>
    readFileSync(
      path.join(__dirname, '../../../fixtures/system-design/qsys-subsystem', name),
      'utf8'
    );
  const system = (modules: string[]) =>
    `<system name="s">${modules
      .map((kind, i) => `<module name="${kind}_${i}" kind="${kind}" version="1" />`)
      .join('')}</system>`;
  const enrichTop = (text: string) =>
    new SystemDesignEnricher().enrich(readQsys(text, 'top.qsys'), '/ws/top.qsys');

  it('grafts a sub_system.qsys instance as a hierarchy level and enriches its children', async () => {
    setup({
      '/ws/top.qsys': fixture('top.qsys'),
      '/ws/lib/sub_system.qsys': fixture('sub_system.qsys'),
      '/ws/mem.ip.yml': IP_YML.replace('My_Core', 'altera_avalon_onchip_memory2'),
    });
    const result = await enrichTop(fixture('top.qsys'));
    expect(result.instances['/sub_0'].kind).toBe('hier');
    expect(result.levels['/sub_0'].source).toEqual({
      fileName: 'lib/sub_system.qsys',
      uri: 'file:///ws/lib/sub_system.qsys',
    });
    expect(result.levels['/sub_0'].instances).toEqual([
      '/sub_0/inner_bridge',
      '/sub_0/onchip_memory2_0',
    ]);
    expect(result.instances['/sub_0'].pins.map((pin) => pin.name)).toEqual(['clk', 'reset', 's0']);
    expect(result.instances['/sub_0/onchip_memory2_0'].definition?.file).toBe('/ws/mem.ip.yml');
    expect(result.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('tags diagnostics about grafted instances with their level', async () => {
    setup({
      '/ws/top.qsys': fixture('top.qsys'),
      '/ws/lib/sub_system.qsys': fixture('sub_system.qsys'),
      '/ws/mem.ip.yml': IP_YML.replace('My_Core', 'altera_avalon_onchip_memory2'),
    });
    const result = await enrichTop(fixture('top.qsys'));
    const notes = result.diagnostics.filter((d) => d.message.startsWith('Pins not in'));
    expect(notes).toHaveLength(1);
    expect(notes[0].level).toBe('/sub_0');
    expect(notes[0].message).toContain('sub_0/onchip_memory2_0/');
    expect(notes[0].lines).toEqual([result.instances['/sub_0/onchip_memory2_0'].line]);
  });

  it('expands nested subsystems', async () => {
    setup({
      '/ws/mid_sys.qsys': system(['leaf_sys']),
      '/ws/leaf_sys.qsys': system(['altera_avalon_pio']),
    });
    const result = await enrichTop(system(['mid_sys']));
    expect(result.instances['/mid_sys_0'].kind).toBe('hier');
    expect(result.instances['/mid_sys_0/leaf_sys_0'].kind).toBe('hier');
    expect(result.instances['/mid_sys_0/leaf_sys_0/altera_avalon_pio_0'].parent).toBe(
      '/mid_sys_0/leaf_sys_0'
    );
    expect(result.levels['/mid_sys_0/leaf_sys_0'].source?.fileName).toBe('leaf_sys.qsys');
  });

  it('stops at a subsystem that instantiates itself', async () => {
    setup({ '/ws/loop_sys.qsys': system(['loop_sys']) });
    const result = await enrichTop(system(['loop_sys']));
    expect(result.instances['/loop_sys_0'].kind).toBe('hier');
    expect(result.instances['/loop_sys_0/loop_sys_0'].kind).toBe('ip');
  });

  it('warns about a mutual cycle and terminates', async () => {
    setup({
      '/ws/a_sys.qsys': system(['b_sys']),
      '/ws/b_sys.qsys': system(['a_sys']),
    });
    const result = await enrichTop(system(['a_sys']));
    expect(result.instances['/a_sys_0/b_sys_0/a_sys_0'].kind).toBe('ip');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: 'a_sys_0: a_sys.qsys instantiates itself.',
        level: '/a_sys_0/b_sys_0',
      })
    );
  });

  it('warns when a subsystem file cannot be read and leaves the instance as ip', async () => {
    setup({ '/ws/bad_sys.qsys': '<system' });
    const result = await enrichTop(system(['bad_sys']));
    expect(result.instances['/bad_sys_0'].kind).toBe('ip');
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      lines: [result.instances['/bad_sys_0'].line],
    });
    expect(result.diagnostics[0].message).toMatch(
      /^bad_sys_0: Could not read subsystem bad_sys\.qsys: /
    );
  });

  it('does not expand in an untrusted workspace', async () => {
    const { workspace } = setup({ '/ws/sub_system.qsys': system(['x']) });
    workspace.isTrusted = false;
    const result = await enrichTop(system(['sub_system']));
    expect(result.instances['/sub_system_0'].kind).toBe('ip');
    expect(workspace.findFiles).not.toHaveBeenCalled();
  });
});
