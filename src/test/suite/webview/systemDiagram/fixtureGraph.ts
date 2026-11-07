import * as fs from 'fs';
import * as path from 'path';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { readQsys } from '../../../../parser/system/QsysReader';
import { readQsysTcl } from '../../../../parser/system/QsysTclReader';
import type { SystemGraph, SystemPin } from '../../../../domain/systemGraph';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/system-design/zynq_dma_system.tcl');

export const fixtureText = fs.readFileSync(FIXTURE, 'utf8');

export function loadFixtureGraph(): SystemGraph {
  return readBdTcl(fixtureText, 'zynq_dma_system.tcl');
}

const CLOCK_FIXTURE = path.resolve(
  __dirname,
  '../../../fixtures/system-design/zynq_clock_domains.tcl'
);

/** The clock and reset domain fixture (issue #243): two PS clocks, a hierarchy on both, an external clock port. */
export function loadClockFixtureGraph(): SystemGraph {
  return readBdTcl(fs.readFileSync(CLOCK_FIXTURE, 'utf8'), 'zynq_clock_domains.tcl');
}

const VERSAL_FIXTURE = path.resolve(__dirname, '../../../fixtures/system-design/versal_clocks.tcl');

/**
 * A Versal-style platform (hardening of #243): endpoints are listed alphabetically, so a net
 * lists a load before its driver; a clocking wizard makes two clocks and sets no frequency.
 */
export function loadVersalClockGraph(): SystemGraph {
  return readBdTcl(fs.readFileSync(VERSAL_FIXTURE, 'utf8'), 'versal_clocks.tcl');
}

/**
 * The Versal graph with every IP named `ip` replaced by one that no rule knows. The
 * rename happens before the read, because the reader gives the pins of a known IP
 * their direction from the rule table.
 */
export function loadVersalGraphWithUnknownIp(ip: string): SystemGraph {
  const text = fs
    .readFileSync(VERSAL_FIXTURE, 'utf8')
    .split(`xilinx.com:ip:${ip}:`)
    .join(`acme.com:ip:other_${ip}:`);
  return readBdTcl(text, 'versal_clocks.tcl');
}

const PORT_CLOCKS_FIXTURE = path.resolve(
  __dirname,
  '../../../fixtures/system-design/subsystem_two_clocks.tcl'
);

/** A kernel-style subsystem whose two clocks enter through ports, one with `-freq_hz`. */
export function loadPortClocksGraph(): SystemGraph {
  return readBdTcl(fs.readFileSync(PORT_CLOCKS_FIXTURE, 'utf8'), 'subsystem_two_clocks.tcl');
}

const QSYS_FIXTURE = path.resolve(
  __dirname,
  '../../../fixtures/system-design/nios_avalon_system.qsys'
);

export const qsysFixtureText = fs.readFileSync(QSYS_FIXTURE, 'utf8');

export function loadQsysFixtureGraph(): SystemGraph {
  return readQsys(qsysFixtureText, 'nios_avalon_system.qsys');
}

const QSYS_TCL_FIXTURE = path.resolve(
  __dirname,
  '../../../fixtures/system-design/niosv_hps_system.tcl'
);

export function loadQsysTclFixtureGraph(): SystemGraph {
  return readQsysTcl(fs.readFileSync(QSYS_TCL_FIXTURE, 'utf8'), 'niosv_hps_system.tcl');
}

/** Deterministic text measure for layout tests: 7 px per character at any weight. */
export const fakeMeasure = (text: string): number => text.length * 7;

function openPin(name: string, direction: SystemPin['direction']): SystemPin {
  return { name, isInterface: false, direction, directionSource: 'declared', parameters: {} };
}

/**
 * The zynq fixture with open pins added: `/axi_gpio_0` gets a definition and
 * three unconnected pins, the `coeff_bank` hierarchy gets an input open on both
 * sides, and the root gets an unconnected output port.
 */
export function loadReviewFixtureGraph(): SystemGraph {
  const graph = loadFixtureGraph();
  const gpio = graph.instances['/axi_gpio_0'];
  gpio.definition = {
    kind: 'ip.yml',
    file: '/ws/gpio.ip.yml',
    uri: 'file:///ws/gpio.ip.yml',
    displayName: 'gpio.ip.yml',
  };
  gpio.pins.push(
    openPin('spare_in', 'in'),
    openPin('spare_out', 'out'),
    openPin('spare_io', 'inout')
  );
  const bank = '/dsp_pipeline/coeff_bank';
  // A hierarchy instance shares its pin list with the boundary pins of its level.
  graph.levels[bank].boundaryPins.push(openPin('cfg_open', 'in'));
  if (graph.instances[bank].pins !== graph.levels[bank].boundaryPins) {
    graph.instances[bank].pins.push(openPin('cfg_open', 'in'));
  }
  graph.levels['/'].boundaryPins.push(openPin('ext_out', 'out'));
  return graph;
}
