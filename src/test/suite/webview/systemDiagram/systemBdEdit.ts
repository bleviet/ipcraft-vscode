/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- the helpers edit parsed JSON of the fixture */
import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../domain/systemGraph';
import { readSystemDesign } from '../../../../services/systemDiagram/readSystemDesign';

const BD_TEXT = fs.readFileSync(
  path.resolve(__dirname, '../../../fixtures/system-design/zynq_gpio_system.bd'),
  'utf8'
);

/** Reads the fixture `.bd` (zynq_gpio_system), with a block written under another name, after `edit` changed its parsed `design` object. */
export function systemBd(
  edit: (design: any) => void = () => undefined,
  rename?: [from: string, to: string]
): SystemGraph {
  const root = JSON.parse(
    rename ? BD_TEXT.replace(new RegExp(`\\b${rename[0]}\\b`, 'g'), rename[1]) : BD_TEXT
  );
  edit(root.design);
  return readSystemDesign('x.bd', 'x.bd', JSON.stringify(root, null, 2))!;
}

/** The pin `axi_periph/M00_AXI` and its net to `axi_gpio_0/S_AXI` are gone. */
export const withoutGpio0Net = (design: any): void => {
  delete design.interface_nets.periph_gpio0;
};

/** Two clock groups in `gpio_block`; `swapped` exchanges the boundary pins that drive them. */
export const twoClockGroups =
  (swapped: boolean) =>
  (design: any): void => {
    const g = design.components.gpio_block;
    g.ports.clk2 = { type: 'clk', direction: 'I' };
    for (const n of ['axi_gpio_2', 'axi_gpio_3', 'axi_gpio_4']) {
      g.components[n] = { vlnv: 'xilinx.com:ip:axi_gpio:2.0' };
    }
    g.nets.block_clk.ports = [
      swapped ? 'clk2' : 'clk',
      'axi_gpio_1/s_axi_aclk',
      'axi_gpio_2/s_axi_aclk',
    ];
    g.nets.block_clk2 = {
      ports: [swapped ? 'clk' : 'clk2', 'axi_gpio_3/s_axi_aclk', 'axi_gpio_4/s_axi_aclk'],
    };
    design.nets.fclk1 = { ports: ['sys_ps7/FCLK_CLK1', 'gpio_block/clk2'] };
  };

/** `gpio_block/axi_gpio_1` is gone with its nets and its address segment; `gpio_block` itself stays. */
export const withoutNestedSlave = (design: any): void => {
  const block = design.components.gpio_block;
  delete block.components.axi_gpio_1;
  block.interface_nets = {};
  block.nets = {};
  delete design.addressing['/sys_ps7'].address_spaces.Data.segments.SEG_axi_gpio_1_Reg;
};
