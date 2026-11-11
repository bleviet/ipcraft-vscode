import type { SystemGraph } from '../../../../../domain/systemGraph';
import { readBdTcl } from '../../../../../parser/system/BdTclReader';
import type { CmakeEntry } from '../../../../../services/systemDiagram/enrichment/cmakeProjects';
import type { EnrichmentIo } from '../../../../../services/systemDiagram/enrichment/enrichmentIo';
import {
  bdTclCandidates,
  expandContainers,
} from '../../../../../services/systemDiagram/enrichment/expandContainers';
import {
  bdTclEntryFromText,
  type FileLocation,
} from '../../../../../services/systemDiagram/enrichment/fileEntries';

const DESIGN = '/ws/fpga/b/src/tcl/top.tcl';
const COMMON = '/ws/fpga/common/src/tcl/part.tcl';

const top = (reference = 'part') =>
  [
    `create_bd_cell -type container -reference ${reference} part`,
    'connect_bd_net -net n [get_bd_pins part/clk] [get_bd_pins part/rst]',
  ].join('\n');
const partScript = (name: string, body = '') =>
  [
    `set design_name ${name}`,
    'create_bd_port -dir I -type clk clk',
    'create_bd_port -dir I -type rst rst',
    'create_bd_cell -type ip -vlnv a:b:c:1 inner',
    body,
  ].join('\n');

const location = (file: string): FileLocation<string> => ({
  file,
  displayName: file.replace('/ws/', ''),
  uri: `file://${file}`,
  ref: file,
});

/** An in-memory workspace; `listed` are the Tcl files the index finds. */
function fakeIo(
  files: Record<string, string>,
  options: {
    cmake?: CmakeEntry[];
    links?: Record<string, string>;
    rejected?: Record<string, string>;
    indexed?: string[];
  } = {}
) {
  const calls = { tcl: 0, cmake: 0, links: 0 };
  const io: EnrichmentIo<string> = {
    listIpFiles: async () => [],
    listHdlFiles: async () => [],
    listQsysFiles: async () => [],
    listBdTclFiles: async () => {
      calls.tcl += 1;
      return (options.indexed ?? Object.keys(files)).map((file) =>
        bdTclEntryFromText(files[file], location(file))
      );
    },
    listCmakeFiles: async () => {
      calls.cmake += 1;
      return options.cmake ?? [];
    },
    locate: location,
    readBdLinks: async () => {
      calls.links += 1;
      return { links: options.links ?? {}, rejected: options.rejected ?? {} };
    },
    readText: async (ref) => {
      if (files[ref] === undefined) {
        throw new Error(`no such file ${ref}`);
      }
      return files[ref];
    },
  };
  return { io, calls };
}

const warnings = (graph: SystemGraph) => graph.diagnostics.filter((d) => d.severity === 'warning');
const read = (text: string) => readBdTcl(text, 'top.tcl');

describe('expandContainers', () => {
  it('grafts the script found by design_name and records the evidence', async () => {
    const { io } = fakeIo({ [COMMON]: partScript('part') });
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part'].kind).toBe('hier');
    expect(graph.instances['/part/inner']).toBeDefined();
    expect(graph.instances['/part'].container).toEqual({
      reference: 'part',
      source: {
        fileName: 'fpga/common/src/tcl/part.tcl',
        uri: `file://${COMMON}`,
        evidence: 'design_name',
      },
    });
    expect(graph.levels['/part'].source?.fileName).toBe('fpga/common/src/tcl/part.tcl');
  });

  it('prefers the script listed in the CMake project', async () => {
    const other = '/ws/fpga/other/src/tcl/part.tcl';
    const { io } = fakeIo(
      { [COMMON]: partScript('part'), [other]: partScript('part'), [DESIGN]: top() },
      { cmake: [{ file: '/ws/fpga/b/CMakeLists.txt', projects: [[DESIGN, COMMON]] }] }
    );
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part'].container?.source).toMatchObject({
      fileName: 'fpga/common/src/tcl/part.tcl',
      evidence: 'cmake',
    });
    expect(warnings(graph)).toEqual([]);
  });

  it('never reads a non-Tcl file listed in a project', async () => {
    const bd = '/ws/fpga/common/src/tcl/part.bd';
    const { io } = fakeIo(
      { [COMMON]: partScript('part'), [bd]: 'not tcl' },
      {
        indexed: [],
        cmake: [{ file: '/c/CMakeLists.txt', projects: [[DESIGN, bd, COMMON]] }],
      }
    );
    const readText = jest.spyOn(io, 'readText');
    await expandContainers(read(top()), DESIGN, io);
    expect(readText).toHaveBeenCalledWith(COMMON);
    expect(readText).not.toHaveBeenCalledWith(bd);
  });

  it('ignores a rejected link with a warning', async () => {
    const { io } = fakeIo(
      { [COMMON]: partScript('part') },
      { rejected: { part: '../../evil.bd' } }
    );
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part'].container?.source?.evidence).toBe('design_name');
    expect(warnings(graph).map((d) => d.message)).toEqual([
      'part: .ipcraft/bd-links.json links part to ../../evil.bd, which is not a .tcl file inside the workspace folder; ignored.',
    ]);
  });

  it('reads a project script the workspace index does not list', async () => {
    const { io } = fakeIo(
      { [COMMON]: partScript('part') },
      { indexed: [], cmake: [{ file: '/c/CMakeLists.txt', projects: [[DESIGN, COMMON]] }] }
    );
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part'].container?.source?.evidence).toBe('cmake');
  });

  it('uses the link first', async () => {
    const mine = '/ws/mine/anything.tcl';
    const { io } = fakeIo(
      {
        [COMMON]: partScript('part'),
        [mine]: partScript('part', 'create_bd_cell -type ip -vlnv a:b:c:1 linked'),
      },
      { links: { part: mine } }
    );
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part/linked']).toBeDefined();
    expect(graph.instances['/part'].container?.source?.evidence).toBe('link');
  });

  it('falls back to automatic resolution when the link cannot be read', async () => {
    const { io } = fakeIo({ [COMMON]: partScript('part') }, { links: { part: '/ws/gone.tcl' } });
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part'].container?.source?.evidence).toBe('design_name');
    expect(warnings(graph).map((d) => d.message)).toEqual([
      'part: .ipcraft/bd-links.json links part to /ws/gone.tcl, which cannot be read; using automatic resolution.',
    ]);
  });

  it('expands nested containers with the script as the design', async () => {
    const nested = '/ws/fpga/common/src/tcl/inner.tcl';
    const { io } = fakeIo({
      [COMMON]: partScript('part', 'create_bd_cell -type container -reference deep deep'),
      [nested]: 'set design_name deep\ncreate_bd_cell -type ip -vlnv a:b:c:1 leaf',
    });
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part/deep'].kind).toBe('hier');
    expect(graph.instances['/part/deep/leaf']).toBeDefined();
    expect(graph.instances['/part/deep'].container?.source?.evidence).toBe('design_name');
  });

  it('leaves a script that contains an ancestor as a black box with a warning', async () => {
    const deep = '/ws/fpga/common/src/tcl/deep.tcl';
    const { io } = fakeIo({
      [COMMON]: partScript('part', 'create_bd_cell -type container -reference deep deep'),
      [deep]: partScript('deep', 'create_bd_cell -type container -reference part again'),
    });
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part/deep'].kind).toBe('hier');
    expect(graph.instances['/part/deep/again'].kind).toBe('blackbox');
    expect(warnings(graph)).toContainEqual(
      expect.objectContaining({
        level: '/part/deep',
        message: 'again: fpga/common/src/tcl/part.tcl instantiates itself.',
      })
    );
  });

  it('warns about a missing script and weakens the capabilities', async () => {
    const { io } = fakeIo({});
    const before = read(top());
    const graph = await expandContainers(before, DESIGN, io);
    expect(graph.instances['/part'].kind).toBe('blackbox');
    expect(graph.diagnostics.at(-1)).toMatchObject({
      severity: 'warning',
      lines: [1],
      message:
        'part: no Tcl script defines block design part; shown as a black box. Use Assign Tcl in the details panel to choose one.',
    });
    expect(graph.capabilities.connections).toBe('partial');
    expect(graph.capabilities.addressMap).toBe('partial');
    expect(before.diagnostics.some((d) => d.message.includes('Assign Tcl'))).toBe(false);
  });

  it('warns about several equally near scripts', async () => {
    const { io } = fakeIo({
      '/ws/fpga/x/part.tcl': partScript('part'),
      '/ws/fpga/y/part.tcl': partScript('part'),
    });
    const graph = await expandContainers(read(top()), DESIGN, io);
    expect(graph.instances['/part'].kind).toBe('blackbox');
    expect(graph.diagnostics.at(-1)?.message).toBe(
      'part: several Tcl scripts define block design part: fpga/x/part.tcl, fpga/y/part.tcl. Use Assign Tcl to choose one.'
    );
    expect(graph.capabilities.connections).not.toBe('complete');
  });

  it('warns about a script that cannot be parsed', async () => {
    const { io } = fakeIo({ [COMMON]: partScript('part') }, { links: {} });
    const broken: EnrichmentIo<string> = {
      ...io,
      readText: async () => {
        throw new Error('boom');
      },
    };
    const graph = await expandContainers(read(top()), DESIGN, broken);
    expect(graph.instances['/part'].kind).toBe('blackbox');
    expect(graph.diagnostics.at(-1)?.message).toBe(
      'part: Could not read subsystem fpga/common/src/tcl/part.tcl: boom'
    );
  });

  it('leaves a graph without containers, and other formats, untouched', async () => {
    const { io, calls } = fakeIo({});
    const plain = read('create_bd_cell -type ip -vlnv a:b:c:1 i');
    expect(await expandContainers(plain, DESIGN, io)).toBe(plain);
    const qsys = { ...read(top()), source: { ...read(top()).source, format: 'qsys' as const } };
    expect(await expandContainers(qsys, DESIGN, io)).toBe(qsys);
    expect(calls).toEqual({ tcl: 0, cmake: 0, links: 0 });
  });
});

describe('bdTclCandidates', () => {
  it('lists every candidate with its evidence, using the project and the link', async () => {
    const other = '/ws/fpga/other/src/tcl/part.tcl';
    const mine = '/ws/mine/anything.tcl';
    const { io } = fakeIo(
      { [COMMON]: partScript('part'), [other]: partScript('part'), [mine]: 'puts hi' },
      {
        cmake: [{ file: '/ws/fpga/b/CMakeLists.txt', projects: [[DESIGN, COMMON]] }],
        links: { part: mine },
      }
    );
    const candidates = await bdTclCandidates('part', DESIGN, io);
    expect(candidates.map((c) => [c.entry.file, c.evidence])).toEqual([
      [mine, 'link'],
      [COMMON, 'cmake'],
      [other, 'design_name'],
    ]);
  });
});
