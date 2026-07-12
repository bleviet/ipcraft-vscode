import * as path from 'path';
import { Logger } from '../../../../utils/Logger';
import { TemplateLoader } from '../../../../generator/TemplateLoader';
import { devResourceRoots } from '../../../../services/ResourceRoots';
import {
  resolveBoardPortMap,
  buildPinAssignments,
} from '../../../../generator/board/pinAssignment';
import type { BoardDefinition } from '../../../../generator/board/types';
import type { IpCoreData } from '../../../../generator/types';

const repoRoot = path.resolve(__dirname, '../../../../..');
const resourceRoots = devResourceRoots(repoRoot);
const logger = new Logger('pinAssignment.test');

const de10Nano: BoardDefinition = {
  name: 'DE10-Nano',
  device: '5CSEBA6U23I7',
  family: 'Cyclone V SoC',
  vendor: 'Terasic',
  clocks: [
    { name: 'FPGA_CLK1_50', pin: 'PIN_V11', frequencyHz: 50_000_000, ioStandard: '3.3-V LVTTL' },
  ],
  resets: [{ name: 'KEY0', pin: 'PIN_AH17', polarity: 'activeLow', ioStandard: '3.3-V LVTTL' }],
  ios: [
    {
      name: 'LED0',
      pin: 'PIN_W15',
      direction: 'out',
      polarity: 'activeHigh',
      ioStandard: '3.3-V LVTTL',
    },
  ],
};

const ledBlinkIp: IpCoreData = {
  clocks: [{ name: 'clk', frequency: '50MHz' }],
  resets: [{ name: 'rst_n', polarity: 'activeLow' }],
  ports: [{ name: 'led', direction: 'out', width: 1 }],
};

describe('resolveBoardPortMap / buildPinAssignments', () => {
  it('auto-maps clock, reset, and user ports onto board nets (led_blink on DE10-Nano)', () => {
    const { map, errors } = resolveBoardPortMap(ledBlinkIp, de10Nano);
    expect(errors).toEqual([]);
    expect(map).toEqual({ clk: 'FPGA_CLK1_50', rst_n: 'KEY0', led: 'LED0' });
  });

  it('AC #69.1 — produces set_location_assignment + IO_STANDARD for a mapped led port', () => {
    const { map } = resolveBoardPortMap(ledBlinkIp, de10Nano);
    const { assignments, errors } = buildPinAssignments(de10Nano, map, ['clk', 'rst_n', 'led']);
    expect(errors).toEqual([]);

    const loader = new TemplateLoader(logger, resourceRoots.templatesDir);
    const rendered = loader.render('quartus_pins.tcl.j2', {
      entity_name: 'led_blink',
      board_name: de10Nano.name,
      assignments,
    });

    expect(rendered).toContain('set_location_assignment PIN_W15 -to led');
    expect(rendered).toContain('set_instance_assignment -name IO_STANDARD "3.3-V LVTTL" -to led');
  });

  it('AC #69.2 — a mapped port missing from the top level fails with a precise error', () => {
    const { assignments, errors } = buildPinAssignments(
      de10Nano,
      { led: 'LED0' },
      ['clk', 'rst_n'] // 'led' intentionally absent from the top-level design
    );
    expect(assignments).toEqual([]);
    expect(errors).toEqual([
      "Mapped port 'led' (board net 'LED0') was not found on the top-level design.",
    ]);
  });

  it('AC #69.3 — AMD/Vivado xdc target emits the equivalent constraint for the same board', () => {
    const { map } = resolveBoardPortMap(ledBlinkIp, de10Nano);
    const { assignments } = buildPinAssignments(de10Nano, map, ['clk', 'rst_n', 'led']);

    const loader = new TemplateLoader(logger, resourceRoots.templatesDir);
    const rendered = loader.render('xilinx_pins.xdc.j2', {
      entity_name: 'led_blink',
      board_name: de10Nano.name,
      assignments,
    });

    expect(rendered).toContain('set_property PACKAGE_PIN PIN_W15 [get_ports { led }]');
    expect(rendered).toContain('set_property IOSTANDARD 3.3-V LVTTL [get_ports { led }]');
  });

  it('errors when the IP has more user ports of a direction than the board has matching ios', () => {
    const twoLedIp: IpCoreData = {
      ...ledBlinkIp,
      ports: [
        { name: 'led', direction: 'out', width: 1 },
        { name: 'led2', direction: 'out', width: 1 },
      ],
    };
    const { errors } = resolveBoardPortMap(twoLedIp, de10Nano); // de10Nano fixture has only 1 'out' io
    expect(errors).toEqual([
      "No board 'out' io net available for port 'led2' — every matching board io is already mapped.",
    ]);
  });

  const de10NanoEightLeds: BoardDefinition = {
    ...de10Nano,
    ios: Array.from({ length: 8 }, (_, i) => ({
      name: `LED${i}`,
      pin: `PIN_LED${i}`,
      direction: 'out' as const,
      polarity: 'activeHigh' as const,
      ioStandard: '3.3-V LVTTL',
    })),
  };

  it('a width-8 port consumes 8 distinct board ios, one net per bit', () => {
    const eightLedIp: IpCoreData = {
      ...ledBlinkIp,
      ports: [{ name: 'led', direction: 'out', width: 8 }],
    };
    const { map, errors } = resolveBoardPortMap(eightLedIp, de10NanoEightLeds);
    expect(errors).toEqual([]);
    expect(map.led).toEqual(['LED0', 'LED1', 'LED2', 'LED3', 'LED4', 'LED5', 'LED6', 'LED7']);
  });

  it("a width-8 port produces one indexed pin assignment per bit (regression for #176310 — a bus can't share one pin)", () => {
    const eightLedIp: IpCoreData = {
      ...ledBlinkIp,
      ports: [{ name: 'led', direction: 'out', width: 8 }],
    };
    const { map } = resolveBoardPortMap(eightLedIp, de10NanoEightLeds);
    const { assignments, errors } = buildPinAssignments(de10NanoEightLeds, map, [
      'clk',
      'rst_n',
      'led',
    ]);
    expect(errors).toEqual([]);
    expect(assignments).toHaveLength(2 + 8); // clk + rst_n + 8 led bits
    const ledAssignments = assignments.filter((a) => a.port.startsWith('led['));
    expect(ledAssignments.map((a) => a.port)).toEqual(
      Array.from({ length: 8 }, (_, i) => `led[${i}]`)
    );
    expect(ledAssignments.map((a) => a.pin)).toEqual(
      Array.from({ length: 8 }, (_, i) => `PIN_LED${i}`)
    );
    // Every bit must land on its own physical pin — no duplicates.
    expect(new Set(ledAssignments.map((a) => a.pin)).size).toBe(8);
  });

  it('errors when a width-N port needs more board ios than are available', () => {
    const eightLedIp: IpCoreData = {
      ...ledBlinkIp,
      ports: [{ name: 'led', direction: 'out', width: 8 }],
    };
    const { errors } = resolveBoardPortMap(eightLedIp, de10Nano); // only 1 'out' io available
    expect(errors).toEqual([
      "No board 'out' io net available for port 'led' — every matching board io is already mapped.",
    ]);
  });
});
