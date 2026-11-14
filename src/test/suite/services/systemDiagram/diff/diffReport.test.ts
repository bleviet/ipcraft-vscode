import * as fs from 'fs';
import * as path from 'path';
import type { FindingsDiff, SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { diffFindings } from '../../../../../services/systemDiagram/diff/diffFindings';
import { diffToMarkdown } from '../../../../../services/systemDiagram/diff/diffReport';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';

const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design/diff');
const LABELS = { base: 'HEAD', current: 'working tree' };
const KEEP = { ignoreVersionOnly: false };

function read(file: string, displayName: string) {
  return readSystemDesign(file, displayName, fs.readFileSync(path.join(fixtures, file), 'utf8'))!;
}

function fixtureDiff(base: string, current: string, displayName: string): SystemGraphDiff {
  return diffSystemGraphs(read(base, displayName), read(current, displayName));
}

/** The report of a fixture pair, with the findings that differ between its two designs. */
function fixtureReport(base: string, current: string, displayName: string): string {
  const [from, to] = [read(base, displayName), read(current, displayName)];
  const diff = diffSystemGraphs(from, to);
  return diffToMarkdown(diff, LABELS, { ...KEEP, findings: diffFindings(from, to, diff) });
}

const golden = (file: string) => fs.readFileSync(path.join(fixtures, file), 'utf8');

describe('diffToMarkdown', () => {
  it('matches the golden report of the Vivado .bd pair', () => {
    expect(fixtureReport('zynq_gpio_base.bd', 'zynq_gpio_current.bd', 'system.bd')).toBe(
      golden('zynq_gpio.expected.md')
    );
  });

  it('matches the golden report of the Platform Designer pair', () => {
    expect(fixtureReport('nios_base.qsys', 'nios_current.qsys', 'nios_system.qsys')).toBe(
      golden('nios.expected.md')
    );
  });

  it('matches the golden report of a pair with a renamed block', () => {
    expect(
      fixtureReport('zynq_gpio_rename_base.bd', 'zynq_gpio_rename_current.bd', 'system.bd')
    ).toBe(golden('zynq_gpio_rename.expected.md'));
  });

  it('writes a renamed block as one row with the differing characters in bold, and counts it', () => {
    const diff = fixtureDiff(
      'zynq_gpio_rename_base.bd',
      'zynq_gpio_rename_current.bd',
      'system.bd'
    );
    const text = diffToMarkdown(diff, LABELS, KEEP);
    expect(text).toContain(
      '| → | `axi_gpio_main` | renamed | `axi_gpio_`**`0`** | `axi_gpio_`**`main`** |'
    );
    expect(text).toContain('~1 changed · →1 renamed · v0 version only**');
    expect(text).not.toContain('Address map');
  });

  it('merges the unmarked parts of a name into one code span', () => {
    const diff = fixtureDiff('zynq_gpio_base.bd', 'zynq_gpio_base.bd', 'system.bd');
    diff.instances.push({
      path: '/framebuffer_reader',
      basePath: '/frambuffer_reader',
      level: '/',
      status: 'renamed',
      baseType: 't',
      currentType: 't',
      parameters: [],
      pins: [],
    });
    diff.summary.renamed = 1;
    expect(diffToMarkdown(diff, LABELS, KEEP)).toContain(
      '| → | `framebuffer_reader` | renamed | `frambuffer_reader` | `fram`**`e`**`buffer_reader` |'
    );
  });

  it('keeps renamed blocks, and counts them, with ignoreVersionOnly', () => {
    const diff = fixtureDiff(
      'zynq_gpio_rename_base.bd',
      'zynq_gpio_rename_current.bd',
      'system.bd'
    );
    const text = diffToMarkdown(diff, LABELS, { ignoreVersionOnly: true });
    expect(text).toContain('**+0 added · −0 removed · ~1 changed · →1 renamed**');
    expect(text).toContain('| → | `axi_gpio_main` | renamed |');
  });

  it('matches the golden report of a pair with a block moved into a hierarchy', () => {
    expect(fixtureReport('zynq_gpio_base.bd', 'zynq_gpio_move_current.bd', 'system.bd')).toBe(
      golden('zynq_gpio_move.expected.md')
    );
  });

  it('writes a moved block as one row with its old and new path, and counts it', () => {
    const diff = fixtureDiff('zynq_gpio_base.bd', 'zynq_gpio_move_current.bd', 'system.bd');
    const text = diffToMarkdown(diff, LABELS, KEEP);
    expect(text).toContain(
      '| » | `axi_gpio_0` | moved | `/axi_gpio_0` | `/gpio_block/axi_gpio_0` |'
    );
    // Its rewired pins follow as rows of a changed block.
    expect(text).toContain('| ~ | `axi_gpio_0` | pin `S_AXI` connects to |');
    expect(text).toContain('~2 changed · »1 moved · v0 version only**');
    expect(diffToMarkdown(diff, LABELS, { ignoreVersionOnly: true })).toContain(
      '~2 changed · »1 moved**'
    );
  });

  it('leaves the moved count out of the summary when there is none', () => {
    for (const [base, current] of [
      ['zynq_gpio_base.bd', 'zynq_gpio_current.bd'],
      ['zynq_gpio_rename_base.bd', 'zynq_gpio_rename_current.bd'],
    ]) {
      const text = diffToMarkdown(fixtureDiff(base, current, 'system.bd'), LABELS, KEEP);
      expect(text).not.toContain(' moved');
      expect(text).not.toContain('»');
    }
  });

  it('leaves the renamed count out of the summary when there is none', () => {
    const diff = fixtureDiff('zynq_gpio_base.bd', 'zynq_gpio_current.bd', 'system.bd');
    expect(diffToMarkdown(diff, LABELS, KEEP)).not.toContain('renamed');
  });

  describe('a base that did not exist or was read under another path', () => {
    const diff = () => fixtureDiff('nios_base.qsys', 'nios_current.qsys', 'nios_system.qsys');
    const plain = diffToMarkdown(diff(), LABELS, KEEP);

    it('writes one line after the comparison line for a missing file', () => {
      const missing = diff();
      missing.base.missing = true;
      const text = diffToMarkdown(missing, LABELS, KEEP);
      expect(text).toBe(
        plain.replace(
          'Comparing `HEAD` (base) with `working tree`.\n',
          'Comparing `HEAD` (base) with `working tree`.\n\nThe file did not exist at HEAD: everything is added.\n'
        )
      );
    });

    it('writes the old path in a code span for a renamed file', () => {
      const renamed = diff();
      renamed.base.path = 'ip/old `name`.qsys';
      const text = diffToMarkdown(renamed, LABELS, KEEP);
      expect(text).toContain(
        'Comparing `HEAD` (base) with `working tree`.\n\nRead at HEAD as ``ip/old `name`.qsys`` (renamed since).\n\n'
      );
      expect(text).not.toContain('did not exist');
    });

    it('writes neither line for an ordinary base, so the reports stay as they were', () => {
      expect(plain).not.toContain('did not exist');
      expect(plain).not.toContain('renamed since');
      expect(plain).toBe(golden('nios.expected.md'));
    });

    it('carries the fields in the JSON of the diff, and only when they are set', () => {
      const [missing, renamed] = [diff(), diff()];
      missing.base.missing = true;
      renamed.base.path = 'old.qsys';
      expect(JSON.parse(JSON.stringify(missing)).base).toEqual({
        name: 'nios_system',
        format: 'qsys',
        missing: true,
      });
      expect(JSON.parse(JSON.stringify(renamed)).base).toEqual({
        name: 'nios_system',
        format: 'qsys',
        path: 'old.qsys',
      });
      expect(JSON.parse(JSON.stringify(diff())).base).toEqual({
        name: 'nios_system',
        format: 'qsys',
      });
    });
  });

  it('says No changes. when nothing differs', () => {
    const g = read('nios_base.qsys', 'nios_system.qsys');
    expect(diffToMarkdown(diffSystemGraphs(g, g), LABELS, KEEP)).toBe(
      '## System design changes: nios_system\n\n' +
        'Comparing `HEAD` (base) with `working tree`.\n\n' +
        'No changes.\n'
    );
  });

  it('leaves version rows and the version count out with ignoreVersionOnly', () => {
    const diff = fixtureDiff('nios_base.qsys', 'nios_current.qsys', 'nios_system.qsys');
    const text = diffToMarkdown(diff, LABELS, { ignoreVersionOnly: true });
    expect(text).not.toContain('sysid_qsys_0');
    expect(text).not.toContain('version only');
    expect(text).toContain('**+1 added · −1 removed · ~4 changed**');
  });

  it('says No changes. when only version changes remain and they are ignored', () => {
    const base = read('nios_base.qsys', 'nios_system.qsys');
    const current = readSystemDesign(
      'nios_system.qsys',
      'nios_system.qsys',
      fs
        .readFileSync(path.join(fixtures, 'nios_base.qsys'), 'utf8')
        .replace(
          'kind="altera_avalon_pio" version="18.1"',
          'kind="altera_avalon_pio" version="19.1"'
        )
    )!;
    const diff = diffSystemGraphs(base, current);
    expect(diff.summary.version).toBe(1);
    expect(diffToMarkdown(diff, LABELS, { ignoreVersionOnly: true })).toContain('\nNo changes.\n');
    expect(diffToMarkdown(diff, LABELS, KEEP)).toContain('| v | `pio_0` | version |');
  });

  it('escapes pipes in cell text', () => {
    const base = read('nios_base.qsys', 'nios_system.qsys');
    const diff = diffSystemGraphs(base, base);
    diff.instances.push({
      path: '/a',
      level: '/',
      status: 'changed',
      baseType: 't',
      currentType: 't',
      parameters: [{ key: 'K', base: 'x|y', current: 'z' }],
      pins: [],
    });
    diff.summary.changed = 1;
    expect(diffToMarkdown(diff, LABELS, KEEP)).toContain(
      '| ~ | `a` | parameter `K` | `x\\|y` | `z` |'
    );
  });

  describe('values with line breaks and backticks', () => {
    const reportOf = (key: string, base: string, current: string) => {
      const diff = diffSystemGraphs(
        read('nios_base.qsys', 'nios_system.qsys'),
        read('nios_base.qsys', 'nios_system.qsys')
      );
      diff.instances.push({
        path: '/a',
        level: '/',
        status: 'changed',
        baseType: 't',
        currentType: 't',
        parameters: [{ key, base, current }],
        pins: [],
      });
      diff.summary.changed = 1;
      return diffToMarkdown(diff, LABELS, KEEP);
    };

    it('writes a line break in a value as a space, so the row stays one line', () => {
      expect(reportOf('K', 'set a 1\r\nset b 2\n\n', 'z')).toContain(
        '| ~ | `a` | parameter `K` | `set a 1 set b 2 ` | `z` |'
      );
    });

    it('writes a lone carriage return as a space too', () => {
      expect(reportOf('K', 'a\rb', 'z')).toContain('| ~ | `a` | parameter `K` | `a b` | `z` |');
    });

    it('fences a value that contains backticks with a longer run', () => {
      expect(reportOf('K', 'a`b', 'x``y')).toContain(
        '| ~ | `a` | parameter `K` | ``a`b`` | ```x``y``` |'
      );
    });

    it('pads a value that starts or ends with a backtick', () => {
      expect(reportOf('K', '`a', 'b`')).toContain(
        '| ~ | `a` | parameter `K` | `` `a `` | `` b` `` |'
      );
    });
  });

  it('notes that the revisions use different formats', () => {
    const diff = diffSystemGraphs(
      read('nios_base.qsys', 'nios_system.qsys'),
      read('zynq_gpio_base.bd', 'system.bd')
    );
    expect(diff.formatsDiffer).toBe(true);
    expect(diffToMarkdown(diff, LABELS, KEEP)).toContain(
      'Comparing `HEAD` (base) with `working tree`.\n\n' +
        'The two revisions use different formats (qsys and vivado-bd).\n\n'
    );
  });
  it('writes one row per differing attribute of a hierarchy pin and the parameters of a port', () => {
    const root = JSON.parse(fs.readFileSync(path.join(fixtures, '../zynq_gpio_system.bd'), 'utf8'));
    const base = readSystemDesign('x.bd', 'x.bd', JSON.stringify(root))!;
    root.design.components.gpio_block.ports.rst_n.direction = 'O';
    root.design.components.gpio_block.ports.clk.parameters = { FREQ_HZ: { value: '5' } };
    root.design.ports.sys_clk.parameters.FREQ_HZ.value = '1';
    const current = readSystemDesign('x.bd', 'x.bd', JSON.stringify(root))!;
    const text = diffToMarkdown(diffSystemGraphs(base, current), LABELS, KEEP);
    expect(text).toContain('| ~ | `gpio_block` | pin `rst_n` direction | `in` | `out` |');
    expect(text).toContain('| ~ | `gpio_block` | pin `clk` parameter `CONFIG.FREQ_HZ` | | `5` |');
    expect(text).toContain('| ~ | `sys_clk` | CONFIG.FREQ_HZ `125000000` | CONFIG.FREQ_HZ `1` |');
  });

  describe('findings', () => {
    const FINDINGS: FindingsDiff = {
      new: [
        {
          kind: 'undriven',
          level: '/',
          instance: '/axi_gpio_0',
          pin: 's_axi_aclk',
          label: 'axi_gpio_0/s_axi_aclk',
        },
        { kind: 'unused', level: '/h', instance: null, pin: 'led', label: 'led' },
        {
          kind: 'dataCrossing',
          level: '/',
          from: 'a/M_AXIS',
          to: 'b/S_AXIS',
          fromInstance: '/a',
          toInstance: '/b',
          fromClock: 'clkA',
          toClock: 'clkB',
          reason: 'no synchronizer is known | between them',
        },
      ],
      resolved: [
        {
          kind: 'resetCrossing',
          level: '/dsp',
          from: 'rst/out',
          to: 'b/rst_n',
          fromInstance: '/rst',
          toInstance: '/b',
          toClock: 'clkB',
          reason: 'released on clkA',
        },
      ],
    };
    const NOTE =
      'Findings are computed from the design files alone; workspace definitions are not used, so pins of blocks without a known pin list are not checked.';
    const withFindings = (diff: SystemGraphDiff, findings: FindingsDiff) =>
      diffToMarkdown(diff, LABELS, { ...KEEP, findings });
    const nios = () => fixtureDiff('nios_base.qsys', 'nios_current.qsys', 'nios_system.qsys');

    it('writes the Findings table, new rows first, between the summary and the address map', () => {
      const text = withFindings(nios(), FINDINGS);
      expect(text).toContain(
        '~4 changed · v1 version only · 3 new findings · 1 resolved finding**\n\n' +
          '### Findings\n' +
          '| | Finding | Where | Detail |\n' +
          '|---|---|---|---|\n' +
          '| New | undriven pin | `axi_gpio_0/s_axi_aclk` | |\n' +
          '| New | unused pin | `led` on level `/h` | |\n' +
          '| New | data crossing | `a/M_AXIS` → `b/S_AXIS` | `clkA` → `clkB` · no synchronizer is known \\| between them |\n' +
          '| Resolved | reset crossing | `rst/out` → `b/rst_n` on level `/dsp` | unknown clock → `clkB` · released on clkA |\n\n' +
          `${NOTE}\n\n### Address map`
      );
    });

    it('uses the singular for one new finding', () => {
      const text = withFindings(nios(), { new: [FINDINGS.new[0]], resolved: [] });
      expect(text).toContain('v1 version only · 1 new finding · 0 resolved findings**');
    });

    it('prints the summary and the section when only the findings differ', () => {
      const g = read('nios_base.qsys', 'nios_system.qsys');
      const text = withFindings(diffSystemGraphs(g, g), { new: [], resolved: FINDINGS.resolved });
      expect(text).not.toContain('No changes.');
      expect(text).toContain(
        '**+0 added · −0 removed · ~0 changed · v0 version only · 0 new findings · 1 resolved finding**\n\n### Findings\n'
      );
      expect(text.endsWith(`${NOTE}\n`)).toBe(true);
    });

    it('writes no section and keeps No changes. when there are no findings', () => {
      const g = read('nios_base.qsys', 'nios_system.qsys');
      const text = withFindings(diffSystemGraphs(g, g), { new: [], resolved: [] });
      expect(text).toContain('\nNo changes.\n');
      expect(text).not.toContain('Findings');
      expect(withFindings(nios(), { new: [], resolved: [] })).toBe(
        diffToMarkdown(nios(), LABELS, KEEP)
      );
    });
  });
});
