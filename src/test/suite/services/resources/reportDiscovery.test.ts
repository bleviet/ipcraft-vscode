import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readBdJson } from '../../../../parser/system/BdJsonReader';
import { readQsys } from '../../../../parser/system/QsysReader';
import {
  discoverFolderReports,
  discoverProjectReports,
  type ReportCandidate,
} from '../../../../services/resources/reportDiscovery';
import { quartusFixture, vivadoFixture } from './fixtures';

const FIXTURES = path.join(__dirname, '../../../fixtures/reports');
const OOC_IPS = [
  'sys_axi_bram_ctrl_0_0',
  'sys_axi_gpio_0_0',
  'sys_bram_0_0',
  'sys_smartconnect_0_0',
];

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');
const qsys = readQsys(quartusFixture('sys.qsys'), 'sys.qsys');

let root: string;

function put(from: string, ...to: string[]): string {
  const target = path.join(root, ...to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (from === '') {
    fs.writeFileSync(target, '');
  } else {
    fs.copyFileSync(path.join(FIXTURES, from), target);
  }
  return target;
}

const byLabel = (candidates: ReportCandidate[], label: string): ReportCandidate => {
  const found = candidates.find((c) => c.label === label);
  if (!found) {
    throw new Error(`no candidate ${label}: ${candidates.map((c) => c.label).join(', ')}`);
  }
  return found;
};

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-reports-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A Vivado project laid out like a real one, with the design file deep inside `proj.srcs`. */
function vivadoProject(): { design: string; stop: string; runs: string } {
  const design = put('', 'proj', 'proj.srcs', 'sources_1', 'bd', 'sys', 'sys.bd');
  put('', 'proj', 'proj.xpr');
  const runs = path.join(root, 'proj', 'proj.runs');
  put('vivado/spike/synth_hier.rpt', 'proj', 'proj.runs', 'synth_1', 'sys_wrapper_hier_synth.rpt');
  put(
    'vivado/spike/synth_flat.rpt',
    'proj',
    'proj.runs',
    'synth_1',
    'sys_wrapper_utilization_synth.rpt'
  );
  put('vivado/spike/routed_hier.rpt', 'proj', 'proj.runs', 'impl_1', 'impl_hier.rpt');
  put(
    'vivado/spike/routed_flat.rpt',
    'proj',
    'proj.runs',
    'impl_1',
    'sys_wrapper_utilization_routed.rpt'
  );
  put(
    'vivado/spike/sys_wrapper_utilization_placed.rpt',
    'proj',
    'proj.runs',
    'impl_1',
    'sys_wrapper_utilization_placed.rpt'
  );
  put(
    'vivado/spike/sys_wrapper_timing_summary_routed.rpt',
    'proj',
    'proj.runs',
    'impl_1',
    'sys_wrapper_timing_summary_routed.rpt'
  );
  for (const ip of OOC_IPS) {
    put(
      `vivado/spike/ooc/${ip}_utilization_synth.rpt`,
      'proj',
      'proj.runs',
      `${ip}_synth_1`,
      `${ip}_utilization_synth.rpt`
    );
  }
  return { design, stop: path.join(root, 'proj'), runs };
}

describe('discoverProjectReports: Vivado', () => {
  it('finds the hierarchical reports of every run folder with their stage and capacity file', async () => {
    const { design, stop, runs } = vivadoProject();
    const { candidates } = await discoverProjectReports(design, bd, stop);

    const routed = byLabel(candidates, 'Post-route (impl_1)');
    expect(routed).toMatchObject({
      vendor: 'vivado',
      stage: 'routed',
      group: 'hierarchy',
      usable: true,
    });
    expect(routed.files).toEqual([path.join(runs, 'impl_1', 'impl_hier.rpt')]);
    // The flat report of the same stage and device, not the placed one.
    expect(routed.capacityFile).toBe(
      path.join(runs, 'impl_1', 'sys_wrapper_utilization_routed.rpt')
    );
    expect(routed.date).toBe('Sat Nov 21 03:51:54 2026');

    const synth = byLabel(candidates, 'Post-synthesis (synth_1)');
    expect(synth).toMatchObject({ stage: 'synth', usable: true });
    expect(synth.capacityFile).toBe(
      path.join(runs, 'synth_1', 'sys_wrapper_utilization_synth.rpt')
    );
  });

  it('groups the per-IP out-of-context reports into one candidate', async () => {
    const { design, stop, runs } = vivadoProject();
    const { candidates } = await discoverProjectReports(design, bd, stop);

    const ooc = candidates.filter((c) => c.group === 'ooc');
    expect(ooc).toHaveLength(1);
    expect(ooc[0]).toMatchObject({
      id: `ooc:${runs}`,
      stage: 'ooc',
      label: 'Per-IP OOC (4 of 5 IPs)',
      usable: true,
    });
    expect(ooc[0].files.map((f) => path.basename(f)).sort()).toEqual(
      OOC_IPS.map((ip) => `${ip}_utilization_synth.rpt`)
    );
  });

  it('lists the flat design reports as unusable and names the -hierarchical option', async () => {
    const { design, stop } = vivadoProject();
    const { candidates } = await discoverProjectReports(design, bd, stop);

    // The flat reports of the stages that have a hierarchical report only serve as capacity.
    const flat = candidates.filter((c) => !c.usable);
    expect(flat.map((c) => path.basename(c.files[0]))).toEqual([
      'sys_wrapper_utilization_placed.rpt',
    ]);
    expect(flat[0].reason).toContain('-hierarchical');
  });

  it('turns a report that cannot be read into an unusable candidate with the reason', async () => {
    const { design, stop, runs } = vivadoProject();
    const broken = path.join(runs, 'impl_1', 'broken.rpt');
    fs.symlinkSync(path.join(root, 'missing.rpt'), broken);

    const { candidates } = await discoverProjectReports(design, bd, stop);

    const failed = candidates.find((c) => c.files[0] === broken);
    expect(failed).toMatchObject({ usable: false, vendor: 'vivado' });
    expect(failed?.reason).toContain('broken.rpt could not be read');
    expect(failed?.reason).not.toContain(root);
    expect(candidates.filter((c) => c.usable).map((c) => c.stage)).toEqual(
      expect.arrayContaining(['routed', 'synth', 'ooc'])
    );
  });

  it('skips reports that are not utilization reports', async () => {
    const { design, stop } = vivadoProject();
    const { candidates } = await discoverProjectReports(design, bd, stop);
    expect(candidates.some((c) => c.files[0].includes('timing_summary'))).toBe(false);
  });

  it('reports every folder it looked in, up to the stop folder', async () => {
    const { design, stop, runs } = vivadoProject();
    const { searched } = await discoverProjectReports(design, bd, stop);
    expect(searched).toEqual([
      path.dirname(design),
      path.join(stop, 'proj.srcs', 'sources_1', 'bd'),
      path.join(stop, 'proj.srcs', 'sources_1'),
      path.join(stop, 'proj.srcs'),
      stop,
      runs,
    ]);
  });

  it('gives up after six folders when there is no stop folder', async () => {
    const deep = path.join(root, 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'sys.bd');
    fs.mkdirSync(path.dirname(deep), { recursive: true });
    const { candidates, searched } = await discoverProjectReports(deep, bd);
    expect(candidates).toEqual([]);
    expect(searched).toHaveLength(6);
    expect(searched[0]).toBe(path.dirname(deep));
  });

  it('finds nothing in a project without runs', async () => {
    const design = put('', 'proj', 'sys.bd');
    put('', 'proj', 'proj.xpr');
    const { candidates, searched } = await discoverProjectReports(
      design,
      bd,
      path.join(root, 'proj')
    );
    expect(candidates).toEqual([]);
    expect(searched).toEqual([path.join(root, 'proj')]);
  });
});

describe('discoverProjectReports: Quartus', () => {
  const spike = (name: string) => `quartus/platform_designer_system/${name}`;

  it('reads PROJECT_OUTPUT_DIRECTORY from the revision qsf', async () => {
    const design = put('', 'q', 'sys.qsys');
    put('', 'q', 'spike.qpf');
    fs.writeFileSync(path.join(root, 'q', 'spike.qpf'), 'PROJECT_REVISION = "spike"\n');
    fs.writeFileSync(
      path.join(root, 'q', 'spike.qsf'),
      'set_global_assignment -name PROJECT_OUTPUT_DIRECTORY output_files\n'
    );
    const out = path.join(root, 'q', 'output_files');
    put(spike('spike.map.rpt'), 'q', 'output_files', 'spike.map.rpt');
    put(spike('spike.fit.rpt'), 'q', 'output_files', 'spike.fit.rpt');
    put(spike('spike.fit.summary'), 'q', 'output_files', 'spike.fit.summary');
    // A copy in the project folder must not be used when the output folder is set.
    put(spike('spike.fit.rpt'), 'q', 'spike.fit.rpt');

    const { candidates, searched } = await discoverProjectReports(
      design,
      qsys,
      path.join(root, 'q')
    );

    expect(candidates.map((c) => c.label).sort()).toEqual([
      'Fitter (spike.fit.rpt)',
      'Synthesis (spike.map.rpt)',
    ]);
    const fit = byLabel(candidates, 'Fitter (spike.fit.rpt)');
    expect(fit).toMatchObject({ vendor: 'quartus', stage: 'fit', usable: true });
    expect(fit.files).toEqual([path.join(out, 'spike.fit.rpt')]);
    expect(fit.capacityFile).toBe(path.join(out, 'spike.fit.summary'));
    expect(byLabel(candidates, 'Synthesis (spike.map.rpt)')).toMatchObject({ stage: 'synth' });
    expect(searched).toEqual([path.join(root, 'q'), out]);
  });

  it('uses the project folder without PROJECT_OUTPUT_DIRECTORY and the qpf name without a revision', async () => {
    const design = put('', 'q', 'sys.qsys');
    fs.writeFileSync(path.join(root, 'q', 'spike.qpf'), '# Quartus project\n');
    put(spike('spike.map.rpt'), 'q', 'spike.map.rpt');
    put(spike('spike.fit.rpt'), 'q', 'spike.fit.rpt');
    put(spike('spike.fit.summary'), 'q', 'spike.fit.summary');

    const { candidates, searched } = await discoverProjectReports(
      design,
      qsys,
      path.join(root, 'q')
    );

    expect(candidates.map((c) => c.stage).sort()).toEqual(['fit', 'synth']);
    expect(byLabel(candidates, 'Fitter (spike.fit.rpt)').capacityFile).toBe(
      path.join(root, 'q', 'spike.fit.summary')
    );
    expect(searched).toEqual([path.join(root, 'q')]);
  });

  it('finds a revision whose name differs from the project name', async () => {
    const design = put('', 'q', 'sys.qsys');
    fs.writeFileSync(path.join(root, 'q', 'project.qpf'), 'PROJECT_REVISION = "spike"\n');
    put(spike('spike.fit.rpt'), 'q', 'spike.fit.rpt');
    const { candidates } = await discoverProjectReports(design, qsys, path.join(root, 'q'));
    expect(candidates.map((c) => c.label)).toEqual(['Fitter (spike.fit.rpt)']);
    expect(candidates[0].capacityFile).toBeUndefined();
  });
});

describe('discoverFolderReports', () => {
  function unpack(): string {
    for (const name of [
      'synth_hier.rpt',
      'synth_flat.rpt',
      'routed_hier.rpt',
      'routed_flat.rpt',
      'sys_wrapper_timing_summary_routed.rpt',
    ]) {
      put(`vivado/spike/${name}`, 'artifact', 'vivado', name);
    }
    for (const ip of OOC_IPS) {
      put(`vivado/spike/ooc/${ip}_utilization_synth.rpt`, 'artifact', 'vivado', 'ooc', `${ip}.rpt`);
    }
    for (const name of ['spike.fit.rpt', 'spike.fit.summary']) {
      put(`quartus/platform_designer_system/${name}`, 'artifact', 'quartus', name);
    }
    put(
      'vivado/spike/sys_wrapper_utilization_placed.rpt',
      'artifact',
      'lone',
      'sys_wrapper_utilization_placed.rpt'
    );
    put(
      'quartus/platform_designer_system/spike.fit.rpt',
      'artifact',
      'a',
      'b',
      'c',
      'd',
      'e',
      'too_deep.rpt'
    );
    return path.join(root, 'artifact');
  }

  it('recognizes every report by content and pairs each with the capacity of its own folder', async () => {
    const candidates = await discoverFolderReports(unpack(), bd);
    const vivado = path.join(root, 'artifact', 'vivado');

    const hierarchical = candidates.filter((c) => c.usable && c.group === 'hierarchy');
    const routed = hierarchical.find((c) => c.stage === 'routed');
    const synth = hierarchical.find((c) => c.stage === 'synth' && c.vendor === 'vivado');
    expect(routed?.capacityFile).toBe(path.join(vivado, 'routed_flat.rpt'));
    expect(synth?.capacityFile).toBe(path.join(vivado, 'synth_flat.rpt'));
    const fit = hierarchical.find((c) => c.stage === 'fit');
    expect(fit?.capacityFile).toBe(path.join(root, 'artifact', 'quartus', 'spike.fit.summary'));
  });

  it('groups the OOC reports whose Design is an IP into one candidate', async () => {
    const candidates = await discoverFolderReports(unpack(), bd);
    const ooc = candidates.filter((c) => c.group === 'ooc');
    expect(ooc).toHaveLength(1);
    expect(ooc[0].label).toBe('Per-IP OOC (4 of 5 IPs)');
    expect(ooc[0].files).toHaveLength(4);
  });

  it('refuses flat design reports and timing reports with the reason', async () => {
    const candidates = await discoverFolderReports(unpack(), bd);
    const refused = candidates.filter((c) => !c.usable);

    const flat = refused.filter((c) => c.reason?.includes('-hierarchical'));
    // routed_flat.rpt and synth_flat.rpt only serve as the capacity of their hierarchical reports.
    expect(flat.map((c) => path.basename(c.files[0]))).toEqual([
      'sys_wrapper_utilization_placed.rpt',
    ]);
    const timing = refused.find((c) => c.files[0].endsWith('timing_summary_routed.rpt'));
    expect(timing?.reason).toContain('report_timing_summary');
    expect(timing?.recognition).toMatchObject({ recognized: false, reason: 'not-utilization' });
  });

  it('lists an unreadable file with the reason and still finds the others', async () => {
    const root2 = unpack();
    fs.symlinkSync(path.join(root, 'missing.rpt'), path.join(root2, 'vivado', 'broken.rpt'));
    const candidates = await discoverFolderReports(root2, bd);
    expect(candidates.find((c) => c.files[0].endsWith('broken.rpt'))?.reason).toContain(
      'broken.rpt could not be read'
    );
    expect(candidates.filter((c) => c.usable).length).toBeGreaterThanOrEqual(3);
  });

  it('does not look deeper than four levels', async () => {
    const candidates = await discoverFolderReports(unpack(), bd);
    expect(candidates.some((c) => c.files[0].endsWith('too_deep.rpt'))).toBe(false);
  });

  it('lists a summary with no fitter report as a refusal', async () => {
    put('quartus/platform_designer_system/spike.fit.summary', 'only', 'spike.fit.summary');
    const candidates = await discoverFolderReports(path.join(root, 'only'), qsys);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ usable: false, vendor: 'quartus' });
    expect(candidates[0].reason).toContain('.fit.rpt');
  });

  it('does not treat flat reports as per-IP reports for a design without xci names', async () => {
    const candidates = await discoverFolderReports(unpack(), qsys);
    expect(candidates.some((c) => c.group === 'ooc')).toBe(false);
  });
});
