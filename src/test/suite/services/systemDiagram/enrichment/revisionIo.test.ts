import { readQsys } from '../../../../../parser/system/QsysReader';
import type { EnrichmentIo } from '../../../../../services/systemDiagram/enrichment/enrichmentIo';
import { enrichSystemGraph } from '../../../../../services/systemDiagram/enrichment/enrichSystemGraph';
import {
  hdlEntryFromText,
  ipEntryFromText,
  qsysEntry,
} from '../../../../../services/systemDiagram/enrichment/fileEntries';
import { revisionIo } from '../../../../../services/systemDiagram/enrichment/revisionIo';
import { bdGraph, IP_YML } from './definitionFixtures';

const PULSE = 'entity pulse_gen is\n  port (clk : in std_logic; q : out std_logic);\nend entity;\n';
const PULSE_AT_REVISION =
  'entity pulse_gen is\n  port (clk : in std_logic; old_q : out std_logic);\nend entity;\n';
const DESIGN = '/ws/d.tcl';

const location = (file: string) => ({
  file: `/ws/${file}`,
  displayName: file,
  uri: `file:///ws/${file}`,
  ref: file,
});

/** The working tree: file name -> text. */
function workingTree(files: Record<string, string>): EnrichmentIo<string> {
  const names = (pattern: RegExp) => Object.keys(files).filter((name) => pattern.test(name));
  return {
    listIpFiles: async () => names(/\.ip\.yml$/).map((n) => ipEntryFromText(files[n], location(n))),
    listHdlFiles: async () => names(/\.vhd$/).map((n) => hdlEntryFromText(files[n], location(n))),
    listQsysFiles: async () => names(/\.qsys$/).map((n) => qsysEntry(location(n))),
    readText: async (ref) => files[ref],
  };
}

/** The revision: file name -> text; a name that is not in it is not at the revision. */
function atRevision(files: Record<string, string>) {
  const readAt = jest.fn(async (ref: string) => files[ref]);
  return readAt;
}

const pinNames = (
  graph: { instances: Record<string, { name: string; pins: { name: string }[] }> },
  name: string
) =>
  Object.values(graph.instances)
    .find((instance) => instance.name === name)
    ?.pins.map((pin) => pin.name) ?? [];

describe('revisionIo', () => {
  it('re-reads the matched .ip.yml at the revision: the ports of the revision show up', async () => {
    const readAt = atRevision({
      'my_core.ip.yml': IP_YML.replace(
        '{ name: flag, direction: in }',
        '{ name: old_flag, direction: in }'
      ),
    });
    const io = revisionIo(workingTree({ 'my_core.ip.yml': IP_YML }), readAt);
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(pinNames(graph, 'my_core_0')).toContain('old_flag');
    expect(pinNames(graph, 'my_core_0')).not.toContain('flag');
    expect(graph.instances['/my_core_0'].definition).toMatchObject({
      file: '/ws/my_core.ip.yml',
      displayName: 'my_core.ip.yml',
    });
  });

  it('does not read the .ip.yml files the design cannot match', async () => {
    const readAt = atRevision({
      'my_core.ip.yml': IP_YML,
      'unrelated.ip.yml': IP_YML.replace('My_Core', 'Unrelated'),
      'broken.ip.yml': 'vlnv: [',
    });
    const io = revisionIo(
      workingTree({
        'my_core.ip.yml': IP_YML,
        'unrelated.ip.yml': IP_YML.replace('My_Core', 'Unrelated'),
      }),
      readAt
    );
    await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(readAt.mock.calls.map((call) => call[0])).toEqual(['my_core.ip.yml']);
  });

  it('reads a file once even when several instances match it', async () => {
    const readAt = atRevision({ 'my_core.ip.yml': IP_YML });
    const twice = JSON.parse(JSON.stringify(bdGraph)) as typeof bdGraph;
    twice.instances['/second_0'] = { ...twice.instances['/my_core_0'], path: '/second_0' };
    const io = revisionIo(workingTree({ 'my_core.ip.yml': IP_YML }), readAt);
    const entries = await io.listIpFiles(twice, DESIGN);
    expect(entries).toHaveLength(1);
    expect(readAt).toHaveBeenCalledTimes(1);
  });

  it('drops a matched file that is not at the revision: the instance has no definition', async () => {
    const readAt = atRevision({});
    const io = revisionIo(workingTree({ 'my_core.ip.yml': IP_YML }), readAt);
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(readAt).toHaveBeenCalledTimes(1);
    expect(graph.instances['/my_core_0'].definition).toBeUndefined();
  });

  it('drops a matched file that does not parse at the revision', async () => {
    const io = revisionIo(
      workingTree({ 'my_core.ip.yml': IP_YML }),
      atRevision({ 'my_core.ip.yml': 'vlnv: [' })
    );
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(graph.instances['/my_core_0'].definition).toBeUndefined();
  });

  it('matches with the working tree: a definition whose VLNV changed since is not found', async () => {
    const io = revisionIo(
      workingTree({ 'my_core.ip.yml': IP_YML.replace('My_Core', 'Renamed') }),
      atRevision({ 'my_core.ip.yml': IP_YML })
    );
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(graph.instances['/my_core_0'].definition).toBeUndefined();
  });

  it('reads the HDL file of a module at the revision', async () => {
    const readAt = atRevision({ 'pulse_gen.vhd': PULSE_AT_REVISION });
    const io = revisionIo(workingTree({ 'pulse_gen.vhd': PULSE }), readAt);
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(pinNames(graph, 'pulse_0')).toEqual(expect.arrayContaining(['clk', 'old_q']));
    expect(pinNames(graph, 'pulse_0')).not.toContain('q');
  });

  it('skips an HDL file that is not at the revision, quietly', async () => {
    const log = { warn: jest.fn(), error: jest.fn() };
    const io = revisionIo(workingTree({ 'pulse_gen.vhd': PULSE }), atRevision({}));
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io, log);
    expect(graph.instances['/pulse_0'].definition).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('skips an HDL file larger than 1 MiB at the revision, as the working-tree index does', async () => {
    const big = `${PULSE}${'-- pad\n'.repeat(200000)}`;
    const log = { warn: jest.fn(), error: jest.fn() };
    const io = revisionIo(
      workingTree({ 'pulse_gen.vhd': PULSE }),
      atRevision({ 'pulse_gen.vhd': big })
    );
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io, log);
    expect(graph.instances['/pulse_0'].definition).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('drops a matched .ip.yml whose VLNV at the revision is another one', async () => {
    const io = revisionIo(
      workingTree({ 'my_core.ip.yml': IP_YML }),
      atRevision({ 'my_core.ip.yml': IP_YML.replace('My_Core', 'Another_Core') })
    );
    const graph = await enrichSystemGraph(bdGraph, DESIGN, io);
    expect(graph.instances['/my_core_0'].definition).toBeUndefined();
  });

  it('reads at most 8 definition files at once', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `core_${i}`);
    const files: Record<string, string> = {};
    for (const name of names) {
      files[`${name}.ip.yml`] = IP_YML.replace('My_Core', name);
    }
    const graph = JSON.parse(JSON.stringify(bdGraph)) as typeof bdGraph;
    names.forEach((name, i) => {
      graph.instances[`/c${i}`] = {
        ...graph.instances['/my_core_0'],
        path: `/c${i}`,
        name: `c${i}`,
        vlnv: `acme.com:ip:${name}:1.0`,
      };
    });
    let active = 0;
    let peak = 0;
    const readAt = jest.fn(async (ref: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return files[ref];
    });
    const entries = await revisionIo(workingTree(files), readAt).listIpFiles(graph, DESIGN);
    expect(entries).toHaveLength(20);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });

  describe('when git fails', () => {
    const failing = async (_ref: string): Promise<string | undefined> => {
      throw new Error('offline');
    };

    it('rejects the listing of the .ip.yml files instead of dropping them', async () => {
      const io = revisionIo(workingTree({ 'my_core.ip.yml': IP_YML }), failing);
      await expect(enrichSystemGraph(bdGraph, DESIGN, io)).rejects.toThrow('offline');
    });

    it('stops the enrichment on a failed HDL read: it is not an absent file', async () => {
      const io = revisionIo(workingTree({ 'pulse_gen.vhd': PULSE }), failing);
      const log = { warn: jest.fn(), error: jest.fn() };
      await expect(enrichSystemGraph(bdGraph, DESIGN, io, log)).rejects.toThrow('offline');
      expect(log.error).not.toHaveBeenCalled();
    });

    it('stops the enrichment on a failed subsystem read', async () => {
      const top = readQsys(
        '<system name="top"><module name="sub_0" kind="sub_system" version="1" /></system>',
        'top.qsys'
      );
      const io = revisionIo(workingTree({ 'sub_system.qsys': '<system name="s" />' }), failing);
      await expect(enrichSystemGraph(top, '/ws/top.qsys', io)).rejects.toThrow('offline');
    });
  });

  describe('Platform Designer subsystems', () => {
    const top = readQsys(
      '<system name="top"><module name="sub_0" kind="sub_system" version="1" /></system>',
      'top.qsys'
    );
    const sub = (kind: string) =>
      `<system name="sub_system"><module name="inner" kind="${kind}" version="1" /></system>`;

    it('grafts the subsystem as it was at the revision', async () => {
      const io = revisionIo(
        workingTree({ 'sub_system.qsys': sub('now') }),
        atRevision({ 'sub_system.qsys': sub('then') })
      );
      const graph = await enrichSystemGraph(top, '/ws/top.qsys', io);
      expect(graph.instances['/sub_0'].kind).toBe('hier');
      expect(graph.instances['/sub_0/inner']).toMatchObject({ kind: 'ip', component: 'then' });
    });

    it('keeps the instance opaque, without a note, when the subsystem is not at the revision', async () => {
      const log = { warn: jest.fn(), error: jest.fn() };
      const io = revisionIo(workingTree({ 'sub_system.qsys': sub('now') }), atRevision({}));
      const graph = await enrichSystemGraph(top, '/ws/top.qsys', io, log);
      expect(graph.instances['/sub_0'].kind).toBe('ip');
      expect(graph.diagnostics).toEqual([]);
      expect(log.warn).not.toHaveBeenCalled();
    });

    it('matches ip definitions of the grafted children, which only the expanded graph has', async () => {
      const io = revisionIo(
        workingTree({
          'sub_system.qsys': sub('my_core'),
          'my_core.ip.yml': IP_YML,
        }),
        atRevision({
          'sub_system.qsys': sub('my_core'),
          'my_core.ip.yml': IP_YML.replace(
            '{ name: flag, direction: in }',
            '{ name: old_flag, direction: in }'
          ),
        })
      );
      const graph = await enrichSystemGraph(top, '/ws/top.qsys', io);
      expect(graph.instances['/sub_0/inner'].definition?.displayName).toBe('my_core.ip.yml');
      expect(pinNames(graph, 'inner')).toContain('old_flag');
    });
  });
});
