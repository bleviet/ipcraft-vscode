import * as fs from 'fs';
import * as path from 'path';
import type { FindingsDiff, SystemGraphDiff } from '../../../../domain/systemGraphDiff';
import type { DiagramCompare } from '../../../../shared/messages/systemDiagram';
import { diffSystemGraphs } from '../../../../services/systemDiagram/diff/diffSystemGraphs';
import { readSystemDesign } from '../../../../services/systemDiagram/readSystemDesign';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/system-design/diff');

function read(file: string) {
  return readSystemDesign(file, 'system.bd', fs.readFileSync(path.join(FIXTURES, file), 'utf8'))!;
}

/** The graph of one side of the .bd pair. */
export const zynqGraph = (side: 'base' | 'current') => read(`zynq_gpio_${side}.bd`);

/** Base to current of the Vivado .bd pair: a removed and an added block, a changed one, a version bump, a removed port. */
export function zynqDiff(): SystemGraphDiff {
  return diffSystemGraphs(read('zynq_gpio_base.bd'), read('zynq_gpio_current.bd'));
}

/** The same pair the other way round: the port is added, the removed block is added. */
export function zynqReverseDiff(): SystemGraphDiff {
  return diffSystemGraphs(read('zynq_gpio_current.bd'), read('zynq_gpio_base.bd'));
}

/** Base to current of the pair with a renamed block (`axi_gpio_0` to `axi_gpio_main`) and one changed parameter. */
export function renameDiff(): SystemGraphDiff {
  return diffSystemGraphs(read('zynq_gpio_rename_base.bd'), read('zynq_gpio_rename_current.bd'));
}

/** The current graph of that pair. */
export const renameGraph = () => read('zynq_gpio_rename_current.bd');

/** Base to current of the pair with a block moved into a hierarchy (`axi_gpio_0` into `gpio_block`), its nets rewired. */
export function moveDiff(): SystemGraphDiff {
  return diffSystemGraphs(read('zynq_gpio_base.bd'), read('zynq_gpio_move_current.bd'));
}

/** The current graph of that pair. */
export const moveGraph = () => read('zynq_gpio_move_current.bd');

export function emptyDiff(): SystemGraphDiff {
  return diffSystemGraphs(read('zynq_gpio_base.bd'), read('zynq_gpio_base.bd'));
}

export const compareOf = (
  diff: SystemGraphDiff,
  baseLabel = 'HEAD',
  options: { currentLabel?: string; canSwap?: boolean; findings?: FindingsDiff } = {}
): DiagramCompare => ({
  baseLabel,
  currentLabel: options.currentLabel ?? 'sys/current.bd',
  canSwap: options.canSwap ?? false,
  diff,
  findings: options.findings ?? { new: [], resolved: [] },
});
