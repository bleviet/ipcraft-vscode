import type { InstanceChange, SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import * as fs from 'fs';
import * as path from 'path';
import {
  cellText,
  changeRows,
  type ChangeRow,
} from '../../../../../services/systemDiagram/diff/changeRows';
import { diffToMarkdown } from '../../../../../services/systemDiagram/diff/diffReport';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';

const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design/diff');
const KEEP = { ignoreVersionOnly: false };

/** The row with its cells as plain text, for short assertions. */
const plain = (r: ChangeRow) => ({
  ...r,
  subject: cellText(r.subject),
  change: cellText(r.change),
  base: cellText(r.base),
  current: cellText(r.current),
});
const plainRows = (diff: ReturnType<typeof bd>) => changeRows(diff, KEEP).map(plain);

function read(file: string, displayName: string) {
  return readSystemDesign(file, displayName, fs.readFileSync(path.join(fixtures, file), 'utf8'))!;
}

const bd = (base: string, current: string) =>
  diffSystemGraphs(read(base, 'system.bd'), read(current, 'system.bd'));
const zynq = bd('zynq_gpio_base.bd', 'zynq_gpio_current.bd');
const nios = diffSystemGraphs(
  read('nios_base.qsys', 'nios_system.qsys'),
  read('nios_current.qsys', 'nios_system.qsys')
);

describe('changeRows', () => {
  it('lists the address map, the ports, then the blocks by level', () => {
    const rows = changeRows(zynq, KEEP);
    expect(rows.map((r) => [r.section, r.level])).toEqual([
      ['address', undefined],
      ['address', undefined],
      ['address', undefined],
      ['port', undefined],
      ...Array(7).fill(['level', '/']),
      ['level', '/gpio_block'],
    ]);
  });

  it('describes a segment, which names itself as the target unless removed', () => {
    const rows = plainRows(zynq).filter((r) => r.section === 'address');
    expect(rows[2]).toEqual({
      sign: '~',
      section: 'address',
      subject: 'sys_ps7/Data',
      change: 'gpio_block/axi_gpio_1/S_AXI/Reg',
      base: '0x41210000 · 0x00010000',
      current: '0x41220000 · 0x00010000',
      target: {
        kind: 'segment',
        addressSpace: 'sys_ps7/Data',
        segment: 'gpio_block/axi_gpio_1/S_AXI/Reg',
      },
    });
    expect(rows[0]).toMatchObject({ sign: '−', base: '0x00000000 · 0x100000000', current: '' });
    expect(rows[0].target).toBeUndefined();
  });

  it('describes a removed port without a target', () => {
    const port = plainRows(zynq).find((r) => r.section === 'port');
    expect(port).toEqual({
      sign: '−',
      section: 'port',
      subject: 'led_o',
      change: '',
      base: 'direction out · width 7:0 · not connected',
      current: '',
    });
  });

  it('targets a port that exists in the current revision', () => {
    const added = plainRows(bd('zynq_gpio_current.bd', 'zynq_gpio_base.bd')).find(
      (r) => r.section === 'port'
    );
    expect(added).toMatchObject({
      sign: '+',
      subject: 'led_o',
      target: { kind: 'port', name: 'led_o' },
    });
  });

  it('targets the instance of a block row, except a removed one', () => {
    const level = plainRows(zynq).filter((r) => r.section === 'level');
    const byChange = (subject: string, change: string) =>
      level.find((r) => r.subject === subject && r.change === change)!;
    expect(byChange('axi_gpio_0', 'removed').target).toBeUndefined();
    expect(byChange('axi_gpio_0', 'pin S_AXI connects to').target).toBeUndefined();
    expect(byChange('axis_data_fifo_0', 'added')).toMatchObject({
      sign: '+',
      level: '/',
      base: '',
      current: 'xilinx.com:ip:axis_data_fifo:2.0',
      target: { kind: 'instance', path: '/axis_data_fifo_0' },
    });
    expect(byChange('axis_data_fifo_0', 'pin s_axis_aclk connects to')).toMatchObject({
      current: 'sys_ps7/FCLK_CLK1',
      target: { kind: 'instance', path: '/axis_data_fifo_0' },
    });
    expect(byChange('axi_gpio_1', 'version')).toMatchObject({
      sign: 'v',
      level: '/gpio_block',
      target: { kind: 'instance', path: '/gpio_block/axi_gpio_1' },
    });
  });

  it('names the parameter of a changed block', () => {
    const row = plainRows(zynq).find((r) => r.subject === 'sys_ps7')!;
    expect(row).toMatchObject({
      sign: '~',
      change: 'parameter CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ',
      base: '100',
      current: '150',
      target: { kind: 'instance', path: '/sys_ps7' },
    });
  });

  it('keeps the peers of a pin as one code part', () => {
    const row = plainRows(nios).find((r) => r.subject === 'st_sink_0')!;
    expect(row).toMatchObject({
      sign: '~',
      change: 'pin sink connects to',
      base: 'st_source_0/src',
      current: 'fifo_0/out',
    });
  });

  it('leaves out version-only blocks with ignoreVersionOnly', () => {
    expect(changeRows(nios, KEEP).some((r) => r.sign === 'v')).toBe(true);
    expect(changeRows(nios, { ignoreVersionOnly: true }).some((r) => r.sign === 'v')).toBe(false);
  });

  it('has no rows for an empty diff and survives JSON', () => {
    const same = diffSystemGraphs(read('nios_base.qsys', 'n'), read('nios_base.qsys', 'n'));
    expect(changeRows(same, KEEP)).toEqual([]);
    const rows = changeRows(nios, KEEP);
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
  });

  it('splits a row into items and parts, with names and values as code parts', () => {
    const rows = changeRows(zynq, KEEP);
    const segment = rows.find((r) => r.section === 'address')!;
    expect(segment.base).toEqual([
      [{ text: '0x00000000', code: true }],
      [{ text: '0x100000000', code: true }],
    ]);
    const port = rows.find((r) => r.section === 'port')!;
    expect(port.base).toEqual([
      [{ text: 'direction ' }, { text: 'out', code: true }],
      [{ text: 'width ' }, { text: '7:0', code: true }],
      [{ text: 'not connected' }],
    ]);
    const pin = rows.find((r) => cellText(r.change) === 'pin S_AXI connects to')!;
    expect(pin.change).toEqual([
      [{ text: 'pin ' }, { text: 'S_AXI', code: true }, { text: ' connects to' }],
    ]);
    expect(pin.base).toEqual([[{ text: 'axi_periph/M00_AXI', code: true }]]);
  });

  it('keeps a value with the separators of the report as one piece', () => {
    const value = 'a · b, c|d';
    const base = read('zynq_gpio_base.bd', 'system.bd');
    base.instances['/sys_ps7'].parameters['CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ'] = value;
    const diff = diffSystemGraphs(base, read('zynq_gpio_current.bd', 'system.bd'));
    const row = changeRows(diff, KEEP).find((r) => r.subject[0][0].text === 'sys_ps7')!;
    expect(row.base).toEqual([[{ text: value, code: true }]]);
    expect(cellText(row.base)).toBe(value);
    expect(diffToMarkdown(diff, { base: 'HEAD', current: 'working tree' }, KEEP)).toContain(
      '| ~ | `sys_ps7` | parameter `CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ` | `a · b, c\\|d` | `150` |'
    );
  });

  describe('pin and type rows of a hand-made diff', () => {
    const block = (instance: Partial<InstanceChange>): SystemGraphDiff => ({
      ...nios,
      instances: [
        {
          path: '/hier/blk',
          level: '/hier',
          status: 'changed',
          parameters: [],
          pins: [],
          ...instance,
        },
      ],
      ports: [],
      segments: [],
    });
    const plainOf = (instance: Partial<InstanceChange>) =>
      changeRows(block(instance), KEEP).map((r) => ({
        sign: r.sign,
        level: r.level,
        subject: cellText(r.subject),
        change: cellText(r.change),
        base: cellText(r.base),
        current: cellText(r.current),
        target: r.target,
      }));
    const target = { kind: 'instance', path: '/hier/blk' };

    it('describes the inside view of a hierarchy pin', () => {
      expect(
        plainOf({
          pins: [
            {
              pin: 'S_AXIS',
              status: 'changed',
              inside: true,
              basePeers: ['a/x'],
              currentPeers: ['b/y', 'c/z'],
            },
          ],
        })
      ).toEqual([
        {
          sign: '~',
          level: '/hier',
          subject: 'blk',
          change: 'pin S_AXIS inside connects to',
          base: 'a/x',
          current: 'b/y, c/z',
          target,
        },
      ]);
    });

    it('describes a change of type', () => {
      expect(plainOf({ baseType: 'acme:ip:fifo:1.0', currentType: 'acme:ip:ram:1.0' })).toEqual([
        {
          sign: '~',
          level: '/hier',
          subject: 'blk',
          change: 'type',
          base: 'acme:ip:fifo:1.0',
          current: 'acme:ip:ram:1.0',
          target,
        },
      ]);
    });

    it('describes the attributes of a hierarchy pin that exists on both sides', () => {
      const rows = plainOf({
        pins: [
          {
            pin: 'M_AXI',
            status: 'changed',
            basePeers: ['a/x'],
            currentPeers: ['a/x'],
            attributes: [
              { key: 'width', base: '31:0', current: '63:0' },
              { key: 'CONFIG.DEPTH', base: '16', current: '32' },
            ],
          },
        ],
      });
      expect(rows.map((r) => [r.sign, r.change, r.base, r.current, r.target])).toEqual([
        ['~', 'pin M_AXI width', '31:0', '63:0', target],
        ['~', 'pin M_AXI parameter CONFIG.DEPTH', '16', '32', target],
      ]);
    });

    it('describes a pin that exists on one side only', () => {
      const rows = plainOf({
        pins: [{ pin: 'M_ST', status: 'added', currentPeers: ['fifo/in'] }],
      });
      expect(rows.map((r) => [r.sign, r.change, r.base, r.current])).toEqual([
        ['~', 'pin M_ST added', '', 'fifo/in'],
      ]);
      const gone = plainOf({ pins: [{ pin: 'M_ST', status: 'removed', basePeers: [] }] });
      expect(gone.map((r) => [r.change, r.base, r.current])).toEqual([
        ['pin M_ST removed', 'not connected', ''],
      ]);
    });
  });
});
