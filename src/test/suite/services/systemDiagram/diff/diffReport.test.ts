import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
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

const golden = (file: string) => fs.readFileSync(path.join(fixtures, file), 'utf8');

describe('diffToMarkdown', () => {
  it('matches the golden report of the Vivado .bd pair', () => {
    const diff = fixtureDiff('zynq_gpio_base.bd', 'zynq_gpio_current.bd', 'system.bd');
    expect(diffToMarkdown(diff, LABELS, KEEP)).toBe(golden('zynq_gpio.expected.md'));
  });

  it('matches the golden report of the Platform Designer pair', () => {
    const diff = fixtureDiff('nios_base.qsys', 'nios_current.qsys', 'nios_system.qsys');
    expect(diffToMarkdown(diff, LABELS, KEEP)).toBe(golden('nios.expected.md'));
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
});
