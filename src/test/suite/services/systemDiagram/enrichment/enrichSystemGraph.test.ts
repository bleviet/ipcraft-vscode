import { readFileSync } from 'fs';
import * as path from 'path';
import { readQsys } from '../../../../../parser/system/QsysReader';
import type { EnrichmentIo } from '../../../../../services/systemDiagram/enrichment/enrichmentIo';
import { enrichSystemGraph } from '../../../../../services/systemDiagram/enrichment/enrichSystemGraph';
import {
  hdlEntryFromText,
  ipEntryFromText,
  qsysEntry,
} from '../../../../../services/systemDiagram/enrichment/fileEntries';
import { bdGraph, IP_YML } from './definitionFixtures';

const PULSE = 'entity pulse_gen is\n  port (clk : in std_logic; q : out std_logic);\nend entity;\n';
const fixture = (name: string) =>
  readFileSync(
    path.join(__dirname, '../../../../fixtures/system-design/qsys-subsystem', name),
    'utf8'
  );

const location = (file: string) => ({
  file: `/ws/${file}`,
  displayName: file,
  uri: `file:///ws/${file}`,
  ref: file,
});

/** An in-memory workspace: file name -> text. Counts the list calls. */
function fakeIo(files: Record<string, string>) {
  const calls = { ip: 0, hdl: 0, qsys: 0 };
  const names = (pattern: RegExp) => Object.keys(files).filter((name) => pattern.test(name));
  const io: EnrichmentIo<string> = {
    listIpFiles: async () => {
      calls.ip += 1;
      return names(/\.ip\.yml$/).map((n) => ipEntryFromText(files[n], location(n)));
    },
    listHdlFiles: async () => {
      calls.hdl += 1;
      return names(/\.vhd$/).map((n) => hdlEntryFromText(files[n], location(n)));
    },
    listQsysFiles: async () => {
      calls.qsys += 1;
      return names(/\.qsys$/).map((n) => qsysEntry(location(n)));
    },
    readText: async (ref) => files[ref],
  };
  return { io, calls };
}

const pinNames = (
  graph: { instances: Record<string, { name: string; pins: { name: string }[] }> },
  name: string
) =>
  Object.values(graph.instances)
    .find((instance) => instance.name === name)
    ?.pins.map((pin) => pin.name) ?? [];

describe('enrichSystemGraph', () => {
  it('adds the pins of an ip match and of an HDL module reference', async () => {
    const { io } = fakeIo({ 'my_core.ip.yml': IP_YML, 'pulse_gen.vhd': PULSE });
    const graph = await enrichSystemGraph(bdGraph, '/ws/d.tcl', io);
    expect(pinNames(graph, 'my_core_0')).toContain('irq');
    expect(pinNames(graph, 'pulse_0')).toEqual(expect.arrayContaining(['clk', 'q']));
  });

  it('lists only the file kinds the graph needs', async () => {
    const { io, calls } = fakeIo({ 'my_core.ip.yml': IP_YML });
    await enrichSystemGraph(bdGraph, '/ws/d.tcl', io);
    expect(calls).toEqual({ ip: 1, hdl: 1, qsys: 0 });
    const qsys = readQsys(
      '<system name="s"><module name="a" kind="k" version="1" /></system>',
      's.qsys'
    );
    const second = fakeIo({});
    await enrichSystemGraph(qsys, '/ws/s.qsys', second.io);
    expect(second.calls).toEqual({ ip: 1, hdl: 0, qsys: 1 });
  });

  it('grafts a subsystem and reports one that instantiates itself', async () => {
    const { io } = fakeIo({ 'sub_system.qsys': fixture('sub_system.qsys') });
    const graph = await enrichSystemGraph(
      readQsys(fixture('top.qsys'), 'top.qsys'),
      '/ws/top.qsys',
      io
    );
    expect(graph.levels['/sub_0']).toBeDefined();

    const self = fakeIo({ 'sub_system.qsys': '' });
    const warnings: string[] = [];
    const cyclic = await enrichSystemGraph(
      readQsys(fixture('top.qsys'), 'top.qsys'),
      '/ws/top.qsys',
      {
        ...self.io,
        readText: async () => fixture('top.qsys'),
      },
      { warn: (m) => warnings.push(m), error: () => undefined }
    );
    expect(cyclic.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('reports a subsystem that cannot be read and logs it', async () => {
    const { io } = fakeIo({ 'sub_system.qsys': '' });
    const warnings: string[] = [];
    const graph = await enrichSystemGraph(
      readQsys(fixture('top.qsys'), 'top.qsys'),
      '/ws/top.qsys',
      {
        ...io,
        readText: async () => {
          throw new Error('denied');
        },
      },
      { warn: (m) => warnings.push(m), error: () => undefined }
    );
    expect(warnings[0]).toContain('Could not read subsystem');
    expect(graph.diagnostics.some((d) => d.message.includes('denied'))).toBe(true);
  });
});
