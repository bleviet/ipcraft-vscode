import * as fs from 'fs';
import * as path from 'path';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { readQsys } from '../../../../parser/system/QsysReader';
import type { SystemGraph } from '../../../../domain/systemGraph';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/system-design/zynq_dma_system.tcl');

export const fixtureText = fs.readFileSync(FIXTURE, 'utf8');

export function loadFixtureGraph(): SystemGraph {
  return readBdTcl(fixtureText, 'zynq_dma_system.tcl');
}

const QSYS_FIXTURE = path.resolve(
  __dirname,
  '../../../fixtures/system-design/nios_avalon_system.qsys'
);

export const qsysFixtureText = fs.readFileSync(QSYS_FIXTURE, 'utf8');

export function loadQsysFixtureGraph(): SystemGraph {
  return readQsys(qsysFixtureText, 'nios_avalon_system.qsys');
}
