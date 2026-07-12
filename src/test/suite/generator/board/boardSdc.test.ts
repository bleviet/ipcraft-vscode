import * as path from 'path';
import { Logger } from '../../../../utils/Logger';
import { TemplateLoader } from '../../../../generator/TemplateLoader';
import { devResourceRoots } from '../../../../services/ResourceRoots';
import { primaryBoardClockConstraint } from '../../../../generator/board/boardSdc';
import type { BoardDefinition } from '../../../../generator/board/types';

const repoRoot = path.resolve(__dirname, '../../../../..');
const resourceRoots = devResourceRoots(repoRoot);
const logger = new Logger('boardSdc.test');
const loader = new TemplateLoader(logger, resourceRoots.templatesDir);

const de10Nano: BoardDefinition = {
  name: 'DE10-Nano',
  device: '5CSEBA6U23I7',
  family: 'Cyclone V SoC',
  vendor: 'Terasic',
  clocks: [
    { name: 'FPGA_CLK1_50', pin: 'PIN_V11', frequencyHz: 50_000_000, ioStandard: '3.3-V LVTTL' },
  ],
  resets: [],
  ios: [],
};

describe('board-mode SDC generation', () => {
  it('AC #70.1 — board mode emits create_clock keyed on the board clock net name', () => {
    const boardClock = primaryBoardClockConstraint(de10Nano);
    const rendered = loader.render('quartus_board_sdc.j2', {
      entity_name: 'led_blink',
      board_name: de10Nano.name,
      board_clock: boardClock,
    });

    expect(rendered).toContain(
      'create_clock -period 20.000 -name fpga_clk1_50 [get_ports { fpga_clk1_50 }]'
    );
    expect(rendered).not.toContain('derive_pll_clocks');
  });

  it('AC #70.2 — ip-ooc mode (quartus_sdc.j2) output is unchanged from today', () => {
    const rendered = loader.render('quartus_sdc.j2', {
      entity_name: 'led_blink',
      clocks_with_period: [{ name: 'clk', frequency: '50MHz', period_ns: '20.000' }],
      has_pll: true,
    });

    expect(rendered).toContain('derive_pll_clocks -create_base_clocks');
    expect(rendered).toContain('create_clock -period 20.000 -name clk [get_ports { clk }]');
  });

  it('AC #70.3 — the two modes differ only in clock port name and PLL derivation', () => {
    const ipOocRendered = loader.render('quartus_sdc.j2', {
      entity_name: 'led_blink',
      clocks_with_period: [{ name: 'clk', frequency: '50MHz', period_ns: '20.000' }],
      has_pll: true,
    });
    const boardRendered = loader.render('quartus_board_sdc.j2', {
      entity_name: 'led_blink',
      board_name: de10Nano.name,
      board_clock: primaryBoardClockConstraint(de10Nano),
    });

    // Same period in both — same physical clock, just a different constrained port name.
    expect(ipOocRendered).toContain('-period 20.000 -name clk');
    expect(boardRendered).toContain('-period 20.000 -name fpga_clk1_50');

    // Board mode has no PLL derivation; ip-ooc mode always does (today's behavior).
    expect(ipOocRendered).toContain('derive_pll_clocks');
    expect(boardRendered).not.toContain('derive_pll_clocks');
  });
});
