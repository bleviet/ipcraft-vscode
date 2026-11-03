import * as fs from 'fs';
import * as path from 'path';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import type { SystemGraph } from '../../../../domain/systemGraph';

const FIXTURE = path.resolve(__dirname, '../../../fixtures/system-design/zynq_dma_system.tcl');

export const fixtureText = fs.readFileSync(FIXTURE, 'utf8');

export function loadFixtureGraph(): SystemGraph {
  return readBdTcl(fixtureText, 'zynq_dma_system.tcl');
}
