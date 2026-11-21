import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readBdJson } from '../../../../parser/system/BdJsonReader';
import {
  extractionDir,
  isPlainName,
  writeStamp,
} from '../../../../services/resources/extractionCache';
import {
  discoverProjectReports,
  type ReportCandidate,
} from '../../../../services/resources/reportDiscovery';
import { vivadoFixture } from './fixtures';

const FIXTURES = path.join(__dirname, '../../../fixtures/reports/vivado/spike');
const OOC_IPS = [
  'sys_axi_bram_ctrl_0_0',
  'sys_axi_gpio_0_0',
  'sys_bram_0_0',
  'sys_smartconnect_0_0',
];
const REASON =
  'Extract the report from the checkpoint. This runs Vivado, about a minute for a small design.';

const bd = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');

let root: string;
let storage: string;
let design: string;
let runs: string;

function put(from: string, ...to: string[]): string {
  const target = path.join(runs, ...to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (from === '') {
    fs.writeFileSync(target, 'checkpoint');
  } else {
    fs.copyFileSync(path.join(FIXTURES, from), target);
  }
  return target;
}

/** What an extraction of `dcp` leaves in the storage, as of the checkpoint's current modification time. */
async function cacheOf(dcp: string, files: Record<string, string>): Promise<void> {
  const dir = extractionDir(storage, dcp);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, from] of Object.entries(files)) {
    fs.copyFileSync(path.join(FIXTURES, from), path.join(dir, name));
  }
  await writeStamp(storage, dcp, fs.statSync(dcp).mtimeMs);
}

const discover = async (): Promise<ReportCandidate[]> =>
  (await discoverProjectReports(design, bd, root, storage)).candidates;

const checkpoints = (candidates: ReportCandidate[]) =>
  candidates.filter((c) => c.group === 'checkpoint');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-checkpoints-'));
  storage = path.join(root, 'storage');
  design = path.join(root, 'sys.bd');
  runs = path.join(root, 'proj.runs');
  fs.writeFileSync(design, '');
  fs.writeFileSync(path.join(root, 'proj.xpr'), '');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('checkpoint candidates', () => {
  it('offers the synthesis and routed checkpoints, named like the run, not usable until extracted', async () => {
    const synth = put('', 'synth_1', 'sys_wrapper.dcp');
    const routed = put('', 'impl_1', 'sys_wrapper_routed.dcp');
    put('', 'impl_1', 'sys_wrapper_opt.dcp');

    const found = checkpoints(await discover());
    expect(found.map((c) => [c.label, c.stage, c.files])).toEqual([
      ['Post-route (impl_1)', 'routed', [routed]],
      ['Post-synthesis (synth_1)', 'synth', [synth]],
    ]);
    for (const candidate of found) {
      expect(candidate).toMatchObject({
        vendor: 'vivado',
        usable: false,
        reason: REASON,
        extract: [{ dcp: candidate.files[0] }],
      });
    }
  });

  it('offers the placed checkpoint only when there is no routed one', async () => {
    put('', 'impl_1', 'sys_wrapper_placed.dcp');
    expect(checkpoints(await discover()).map((c) => [c.stage, path.basename(c.files[0])])).toEqual([
      ['placed', 'sys_wrapper_placed.dcp'],
    ]);

    put('', 'impl_1', 'sys_wrapper_routed.dcp');
    expect(checkpoints(await discover()).map((c) => [c.stage, path.basename(c.files[0])])).toEqual([
      ['routed', 'sys_wrapper_routed.dcp'],
    ]);
  });

  it('takes the top from the flat report of the run when several checkpoints could match', async () => {
    put('routed_flat.rpt', 'impl_1', 'sys_wrapper_utilization_routed.rpt');
    put('', 'impl_1', 'other_routed.dcp');
    put('', 'impl_1', 'sys_wrapper_routed.dcp');
    expect(checkpoints(await discover()).map((c) => path.basename(c.files[0]))).toEqual([
      'sys_wrapper_routed.dcp',
    ]);
  });

  it('drops a checkpoint next to a usable report of the same stage', async () => {
    put('routed_hier.rpt', 'impl_1', 'impl_hier.rpt');
    put('', 'impl_1', 'sys_wrapper_routed.dcp');
    put('synth_hier.rpt', 'synth_1', 'synth_hier.rpt');
    put('', 'synth_1', 'sys_wrapper.dcp');
    expect(checkpoints(await discover())).toEqual([]);
  });

  it('keeps a checkpoint of another stage than the reports next to it', async () => {
    put('synth_hier.rpt', 'impl_1', 'late_synth.rpt');
    put('', 'impl_1', 'sys_wrapper_routed.dcp');
    expect(checkpoints(await discover()).map((c) => c.stage)).toEqual(['routed']);
  });

  it('lists the cached extraction instead, as a usable report labelled like the run', async () => {
    const routed = put('', 'impl_1', 'sys_wrapper_routed.dcp');
    await cacheOf(routed, {
      'utilization_hier.rpt': 'routed_hier.rpt',
      'utilization_flat.rpt': 'routed_flat.rpt',
    });
    const found = await discover();
    expect(checkpoints(found)).toEqual([]);
    const cached = found.find((c) => c.label === 'Post-route (impl_1)');
    expect(cached).toMatchObject({
      group: 'hierarchy',
      stage: 'routed',
      usable: true,
      files: [path.join(extractionDir(storage, routed), 'utilization_hier.rpt')],
      capacityFile: path.join(extractionDir(storage, routed), 'utilization_flat.rpt'),
    });
    expect(cached?.extract).toBeUndefined();
    expect(cached?.checkpoint).toBe(routed);
  });

  it('offers the checkpoint again when it changed after the extraction', async () => {
    const routed = put('', 'impl_1', 'sys_wrapper_routed.dcp');
    await cacheOf(routed, {
      'utilization_hier.rpt': 'routed_hier.rpt',
      'utilization_flat.rpt': 'routed_flat.rpt',
    });
    const later = new Date(fs.statSync(routed).mtimeMs + 60000);
    fs.utimesSync(routed, later, later);
    expect(checkpoints(await discover())).toHaveLength(1);
  });

  it('does not look in the storage when there is none', async () => {
    put('', 'impl_1', 'sys_wrapper_routed.dcp');
    const found = (await discoverProjectReports(design, bd, root)).candidates;
    expect(checkpoints(found)).toHaveLength(1);
  });
});

describe('OOC checkpoints', () => {
  function oocRuns(): string {
    for (const ip of OOC_IPS) {
      put(`ooc/${ip}_utilization_synth.rpt`, `${ip}_synth_1`, `${ip}_utilization_synth.rpt`);
    }
    return put('', 'sys_axi_gpio_1_0_synth_1', 'sys_axi_gpio_1_0.dcp');
  }

  it('counts the IP cache hits that have a checkpoint as missing and offers to extract them', async () => {
    const dcp = oocRuns();
    const ooc = (await discover()).find((c) => c.group === 'ooc');
    expect(ooc).toMatchObject({
      label: 'Per-IP OOC (4 of 5 IPs)',
      usable: true,
      extract: [{ dcp, xciName: 'sys_axi_gpio_1_0' }],
    });
    expect(ooc?.files).toHaveLength(4);
  });

  it('has nothing to extract for an IP without a checkpoint', async () => {
    for (const ip of OOC_IPS) {
      put(`ooc/${ip}_utilization_synth.rpt`, `${ip}_synth_1`, `${ip}_utilization_synth.rpt`);
    }
    const ooc = (await discover()).find((c) => c.group === 'ooc');
    expect(ooc?.label).toBe('Per-IP OOC (4 of 5 IPs)');
    expect(ooc?.extract).toBeUndefined();
  });

  it('includes the cached report of an extracted IP in the group', async () => {
    const dcp = oocRuns();
    await cacheOf(dcp, {
      'sys_axi_gpio_1_0_utilization_synth.rpt': 'ooc/sys_axi_gpio_0_0_utilization_synth.rpt',
    });
    const ooc = (await discover()).find((c) => c.group === 'ooc');
    expect(ooc?.label).toBe('Per-IP OOC (5 of 5 IPs)');
    expect(ooc?.extract).toBeUndefined();
    expect(ooc?.files).toContain(
      path.join(extractionDir(storage, dcp), 'sys_axi_gpio_1_0_utilization_synth.rpt')
    );
    expect(ooc?.id).toBe(`ooc:${runs}`);
  });

  it('offers the group for extraction when every IP was an IP cache hit', async () => {
    const dcps = ['sys_axi_gpio_0_0', 'sys_axi_gpio_1_0'].map((ip) =>
      put('', `${ip}_synth_1`, `${ip}.dcp`)
    );
    const ooc = (await discover()).find((c) => c.id === `ooc:${runs}`);
    expect(ooc).toMatchObject({
      group: 'checkpoint',
      stage: 'ooc',
      label: 'Per-IP OOC (0 of 5 IPs)',
      usable: false,
      extract: [
        { dcp: dcps[0], xciName: 'sys_axi_gpio_0_0' },
        { dcp: dcps[1], xciName: 'sys_axi_gpio_1_0' },
      ],
    });
  });

  it('skips an IP whose name is not a plain file name', async () => {
    const evil = {
      ...bd,
      instances: {
        ...bd.instances,
        '/evil': { ...bd.instances['/axi_gpio_0'], path: '/evil', xciName: '../x' },
      },
    };
    put('', 'x_synth_1', 'x.dcp');
    fs.writeFileSync(path.join(root, 'x.dcp'), 'checkpoint');
    fs.writeFileSync(path.join(root, 'x_utilization_synth.rpt'), 'report');
    put('', 'sys_axi_gpio_1_0_synth_1', 'sys_axi_gpio_1_0.dcp');
    const { candidates } = await discoverProjectReports(design, evil, root, storage);
    const ooc = candidates.find((c) => c.id === `ooc:${runs}`);
    expect(ooc?.extract?.map((t) => t.xciName)).toEqual(['sys_axi_gpio_1_0']);
    expect(JSON.stringify(candidates)).not.toContain(path.join(root, 'x.dcp'));
  });

  it.each([
    ['sys_axi_gpio_0_0', true],
    ['../../x', false],
    ['../x', false],
    ['a/b', false],
    ['a\\b', false],
    ['..', false],
    ['.', false],
    ['', false],
  ])('isPlainName(%p) is %p', (name, plain) => {
    expect(isPlainName(name)).toBe(plain);
  });
});
