import type { BdTclEntry } from '../../../../../services/systemDiagram/enrichment/fileEntries';
import { rankBdTcl } from '../../../../../services/systemDiagram/enrichment/rankBdTcl';

const entry = (file: string, designName?: string): BdTclEntry<string> => ({
  file,
  displayName: file,
  uri: `file://${file}`,
  ref: file,
  ...(designName !== undefined && { designName }),
});
const DESIGN = '/fpga/b/src/tcl/top.tcl';

describe('rankBdTcl', () => {
  it('finds each kind of evidence', () => {
    const rank = (sources: Parameters<typeof rankBdTcl<string>>[2]) =>
      rankBdTcl('part', DESIGN, sources).chosen?.evidence;
    expect(rank({ project: [entry('/p/x.tcl', 'part')], workspace: [] })).toBe('cmake');
    expect(rank({ project: [], workspace: [entry('/w/x.tcl', 'part')] })).toBe('design_name');
    expect(rank({ project: [], workspace: [entry('/w/part.tcl')] })).toBe('file_name');
    expect(rank({ project: [], workspace: [entry('/w/other.tcl', 'x')] })).toBeUndefined();
  });

  it('compares exactly and does not name-match a script with another design_name', () => {
    expect(
      rankBdTcl('part', DESIGN, { project: [], workspace: [entry('/w/Part.tcl')] }).candidates
    ).toEqual([]);
    expect(
      rankBdTcl('part', DESIGN, { project: [], workspace: [entry('/w/part.tcl', 'other')] })
        .candidates
    ).toEqual([]);
    expect(
      rankBdTcl('base_partition', DESIGN, {
        project: [],
        workspace: [entry('/w/base_partition_sim_top.tcl')],
      }).candidates
    ).toEqual([]);
  });

  it('prefers stronger evidence and lists a file once, with its strongest', () => {
    const shared = entry('/p/part.tcl', 'part');
    const ranking = rankBdTcl('part', DESIGN, {
      project: [shared],
      workspace: [entry('/fpga/b/src/tcl/near.tcl', 'part'), shared, entry('/w/part.tcl')],
    });
    expect(ranking.candidates.map((c) => [c.entry.file, c.evidence])).toEqual([
      ['/p/part.tcl', 'cmake'],
      ['/fpga/b/src/tcl/near.tcl', 'design_name'],
      ['/w/part.tcl', 'file_name'],
    ]);
    expect(ranking.chosen?.entry.file).toBe('/p/part.tcl');
  });

  it('breaks a tie by distance, and reports one that stays', () => {
    const near = entry('/fpga/b/src/tcl/part.tcl', 'part');
    const far = entry('/fpga/x/src/tcl/part.tcl', 'part');
    expect(rankBdTcl('part', DESIGN, { project: [], workspace: [far, near] }).chosen?.entry).toBe(
      near
    );
    const tie = rankBdTcl('part', DESIGN, {
      project: [],
      workspace: [entry('/fpga/c/src/tcl/part.tcl', 'part'), far],
    });
    expect(tie.chosen).toBeUndefined();
    expect(tie.ambiguous).toHaveLength(2);
  });

  it('does not skip the tie check when the link was dropped as the design itself', () => {
    const ranking = rankBdTcl('part', DESIGN, {
      link: entry(DESIGN),
      project: [],
      workspace: [
        entry('/fpga/c/src/tcl/part.tcl', 'part'),
        entry('/fpga/d/src/tcl/part.tcl', 'part'),
      ],
    });
    expect(ranking.chosen).toBeUndefined();
    expect(ranking.ambiguous).toHaveLength(2);
  });

  it('lets the link win and never offers the design itself', () => {
    const link = entry('/anywhere/mine.tcl');
    const ranking = rankBdTcl('part', DESIGN, {
      link,
      project: [entry('/p/part.tcl', 'part')],
      workspace: [entry(DESIGN, 'part')],
    });
    expect(ranking.chosen).toEqual({ entry: link, evidence: 'link' });
    expect(ranking.candidates.map((c) => c.entry.file)).toEqual([
      '/anywhere/mine.tcl',
      '/p/part.tcl',
    ]);
  });

  it('resolves the vek280 / common pair to common through the project', () => {
    const common = entry(
      '/fpga/dfx_tandem_xilinx_common/src/tcl/base_partition.tcl',
      'base_partition'
    );
    const vek280 = entry(
      '/fpga/dfx_tandem_xilinx_vek280/src/tcl/base_partition.tcl',
      'base_partition'
    );
    const ranking = rankBdTcl('base_partition', '/fpga/dfx_tandem_xilink_vek385/src/tcl/top.tcl', {
      project: [common],
      workspace: [vek280, common],
    });
    expect(ranking.chosen).toEqual({ entry: common, evidence: 'cmake' });
    expect(ranking.ambiguous).toBeUndefined();
  });
});
