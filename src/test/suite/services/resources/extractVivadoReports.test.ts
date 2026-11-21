import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ExtractionError,
  extractCheckpoint,
  extractToCache,
  vivadoVersionNear,
  type RunVivado,
  type VivadoInvocation,
} from '../../../../services/resources/extractVivadoReports';
import { extractionDir } from '../../../../services/resources/extractionCache';
import { vivadoFixture } from './fixtures';

let root: string;
let dcp: string;
let storage: string;

/** A fake Vivado: records the calls and writes the reports named by the script's arguments. */
function fakeVivado(options: { fail?: boolean; skip?: string[] } = {}) {
  const calls: VivadoInvocation[] = [];
  const run: RunVivado = (invocation) => {
    calls.push(invocation);
    if (options.fail) {
      return Promise.resolve({ success: false, exitCode: 1, output: 'ERROR: [Common 17-69]\nbad' });
    }
    const tclArgs = invocation.args.slice(invocation.args.indexOf('-tclargs') + 1);
    const names = tclArgs.length === 3 ? [tclArgs[2]] : undefined;
    const files = names ?? ['utilization_hier.rpt', 'utilization_flat.rpt'];
    for (const file of files.filter((f) => !options.skip?.includes(f))) {
      fs.writeFileSync(path.join(invocation.cwd, path.basename(file)), 'report');
    }
    return Promise.resolve({ success: true, exitCode: 0, output: '' });
  };
  return { run, calls };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-extract-'));
  storage = path.join(root, 'storage');
  fs.mkdirSync(path.join(root, 'proj.runs', 'impl_1'), { recursive: true });
  dcp = path.join(root, 'proj.runs', 'impl_1', 'top_routed.dcp');
  fs.writeFileSync(dcp, 'checkpoint');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('extractCheckpoint', () => {
  it('writes the script and runs Vivado in batch mode with the checkpoint and the output folder', async () => {
    const out = path.join(root, 'out');
    const vivado = fakeVivado();
    const reports = await extractCheckpoint({ dcp, outDir: out, run: vivado.run });

    const script = path.join(out, 'extract.tcl');
    expect(fs.readFileSync(script, 'utf8')).toBe(
      [
        'open_checkpoint [lindex $argv 0]',
        'report_utilization -hierarchical -file [file join [lindex $argv 1] utilization_hier.rpt]',
        'report_utilization -file [file join [lindex $argv 1] utilization_flat.rpt]',
        'exit',
        '',
      ].join('\n')
    );
    expect(vivado.calls).toEqual([
      {
        args: ['-mode', 'batch', '-source', script, '-nojournal', '-nolog', '-tclargs', dcp, out],
        cwd: out,
        extraMounts: [],
      },
    ]);
    expect(reports).toEqual({
      hierarchical: path.join(out, 'utilization_hier.rpt'),
      flat: path.join(out, 'utilization_flat.rpt'),
    });
  });

  it('maps the paths for a container: the checkpoint folder read-only at /ipcraft-dcp, the output at /work', async () => {
    const out = path.join(root, 'out');
    const vivado = fakeVivado();
    await extractCheckpoint({ dcp, outDir: out, run: vivado.run, docker: true });
    expect(vivado.calls).toEqual([
      {
        args: [
          '-mode',
          'batch',
          '-source',
          '/work/extract.tcl',
          '-nojournal',
          '-nolog',
          '-tclargs',
          '/ipcraft-dcp/top_routed.dcp',
          '/work',
        ],
        cwd: out,
        extraMounts: [{ host: path.dirname(dcp), container: '/ipcraft-dcp', ro: true }],
      },
    ]);
  });

  it('writes only the flat report of an out-of-context IP, named by the IP, passed as an argument', async () => {
    const out = path.join(root, 'out');
    const vivado = fakeVivado();
    const reports = await extractCheckpoint({
      dcp,
      outDir: out,
      run: vivado.run,
      ooc: { xciName: 'sys_gpio_0_0' },
    });
    expect(fs.readFileSync(path.join(out, 'extract.tcl'), 'utf8')).not.toContain('-hierarchical');
    expect(vivado.calls[0].args.slice(-3)).toEqual([
      dcp,
      out,
      'sys_gpio_0_0_utilization_synth.rpt',
    ]);
    expect(reports).toEqual({ flat: path.join(out, 'sys_gpio_0_0_utilization_synth.rpt') });
  });

  it('throws a typed error with the end of the output when the run fails', async () => {
    const error = await extractCheckpoint({
      dcp,
      outDir: path.join(root, 'out'),
      run: fakeVivado({ fail: true }).run,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect(error).toMatchObject({
      message: 'Vivado could not write the report from top_routed.dcp (exit code 1).',
      outputTail: 'ERROR: [Common 17-69]\nbad',
    });
  });

  it('throws when Vivado exits normally but wrote no report at all', async () => {
    const error = await extractCheckpoint({
      dcp,
      outDir: path.join(root, 'out'),
      run: fakeVivado({ skip: ['utilization_hier.rpt', 'utilization_flat.rpt'] }).run,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as Error).message).toContain('utilization_hier.rpt');
  });

  it('refuses an IP name that is not a plain file name, and runs nothing', async () => {
    const vivado = fakeVivado();
    for (const xciName of ['../../x', 'a/b', '..', '']) {
      await expect(
        extractCheckpoint({
          dcp,
          outDir: path.join(root, 'out'),
          run: vivado.run,
          ooc: { xciName },
        })
      ).rejects.toBeInstanceOf(ExtractionError);
    }
    expect(vivado.calls).toEqual([]);
  });

  it('throws when Vivado succeeds without writing a report', async () => {
    const error = await extractCheckpoint({
      dcp,
      outDir: path.join(root, 'out'),
      run: fakeVivado({ skip: ['utilization_flat.rpt'] }).run,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as Error).message).toContain('utilization_flat.rpt');
  });
});

describe('extractToCache', () => {
  const dirOf = () =>
    path.join(
      storage,
      'resource-extracts',
      crypto.createHash('sha1').update(path.resolve(dcp)).digest('hex').slice(0, 16)
    );

  it('writes into <storage>/resource-extracts/<sha1 of the path>/ with a stamp of the checkpoint', async () => {
    const vivado = fakeVivado();
    const reports = await extractToCache({ dcp, storage, run: vivado.run });
    expect(extractionDir(storage, dcp)).toBe(dirOf());
    expect(path.basename(dirOf())).toMatch(/^[0-9a-f]{16}$/);
    expect(reports.hierarchical).toBe(path.join(dirOf(), 'utilization_hier.rpt'));
    expect(JSON.parse(fs.readFileSync(path.join(dirOf(), 'source.json'), 'utf8'))).toEqual({
      dcp,
      mtimeMs: fs.statSync(dcp).mtimeMs,
    });
  });

  it('reuses the reports while the checkpoint keeps its modification time', async () => {
    const vivado = fakeVivado();
    const first = await extractToCache({ dcp, storage, run: vivado.run });
    const second = await extractToCache({ dcp, storage, run: vivado.run });
    expect(second).toEqual(first);
    expect(vivado.calls).toHaveLength(1);
  });

  it('replaces the reports when the checkpoint has changed, dropping the old files', async () => {
    const vivado = fakeVivado();
    await extractToCache({ dcp, storage, run: vivado.run });
    fs.writeFileSync(path.join(dirOf(), 'stale.txt'), 'old');
    const first = new Date(fs.statSync(dcp).mtimeMs);
    const later = new Date(first.getTime() + 60000);
    fs.utimesSync(dcp, later, later);

    await extractToCache({ dcp, storage, run: vivado.run });
    expect(vivado.calls).toHaveLength(2);
    expect(fs.existsSync(path.join(dirOf(), 'stale.txt'))).toBe(false);
    const stamp = JSON.parse(fs.readFileSync(path.join(dirOf(), 'source.json'), 'utf8')) as {
      mtimeMs: number;
    };
    expect(stamp.mtimeMs).toBe(fs.statSync(dcp).mtimeMs);
    expect(stamp.mtimeMs).toBeGreaterThan(first.getTime());
  });

  it('keeps a failed extraction out of the cache', async () => {
    await expect(
      extractToCache({ dcp, storage, run: fakeVivado({ fail: true }).run })
    ).rejects.toBeInstanceOf(ExtractionError);
    expect(fs.existsSync(dirOf())).toBe(false);

    const vivado = fakeVivado();
    await extractToCache({ dcp, storage, run: vivado.run });
    expect(vivado.calls).toHaveLength(1);
  });

  it('caches an OOC IP checkpoint by its flat report', async () => {
    const vivado = fakeVivado();
    const request = { dcp, storage, run: vivado.run, ooc: { xciName: 'sys_gpio_0_0' } };
    const first = await extractToCache(request);
    expect(first).toEqual({ flat: path.join(dirOf(), 'sys_gpio_0_0_utilization_synth.rpt') });
    await extractToCache(request);
    expect(vivado.calls).toHaveLength(1);
  });
});

describe('vivadoVersionNear', () => {
  it('reads the Vivado version of a report in the checkpoint folder', async () => {
    const dir = path.dirname(dcp);
    fs.writeFileSync(path.join(dir, 'a.rpt'), 'not a report');
    fs.writeFileSync(path.join(dir, 'b.rpt'), vivadoFixture('routed_hier.rpt'));
    expect(await vivadoVersionNear(dcp)).toBe('2024.2');
  });

  it('is undefined without a report next to the checkpoint', async () => {
    expect(await vivadoVersionNear(dcp)).toBeUndefined();
    expect(await vivadoVersionNear(path.join(root, 'nowhere', 'x.dcp'))).toBeUndefined();
  });
});
