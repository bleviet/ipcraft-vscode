/**
 * The findings of a {@link FindingsDiff} as table rows with structured cells: the one row model of
 * the Markdown report's Findings section and the viewer's Findings tab. Pure and JSON-serializable.
 */

import type { Finding, FindingsDiff } from '../../../domain/systemGraphDiff';
import type { Cell, CellPart } from './changeRows';

export interface FindingRow {
  sign: 'New' | 'Resolved';
  finding: Finding;
  /** The name of the kind of finding, e.g. `undriven pin`. */
  kind: string;
  /** The pin or the two ends of the crossing, and the level when it is not the root (labels are code parts). */
  where: Cell;
  /** A crossing: its clocks, then the analysis's reason, one item each; empty for an unconnected pin. */
  detail: Cell;
}

const FINDING_NAMES: Record<Finding['kind'], string> = {
  undriven: 'undriven pin',
  unused: 'unused pin',
  dataCrossing: 'data crossing',
  resetCrossing: 'reset crossing',
};

const plain = (text: string): CellPart => ({ text });
const code = (text: string): CellPart => ({ text, code: true });
const clock = (label: string | undefined): CellPart =>
  label === undefined ? plain('unknown clock') : code(label);

function findingRow(sign: FindingRow['sign'], finding: Finding): FindingRow {
  const onLevel = finding.level === '/' ? [] : [plain(' on level '), code(finding.level)];
  if ('label' in finding) {
    return {
      sign,
      finding,
      kind: FINDING_NAMES[finding.kind],
      where: [[code(finding.label), ...onLevel]],
      detail: [],
    };
  }
  return {
    sign,
    finding,
    kind: FINDING_NAMES[finding.kind],
    where: [[code(finding.from), plain(' → '), code(finding.to), ...onLevel]],
    detail: [
      [clock(finding.fromClock), plain(' → '), clock(finding.toClock)],
      [plain(finding.reason)],
    ],
  };
}

/** The new findings, then the resolved ones, each in the order of `findings`. */
export function findingRows({ new: added, resolved }: FindingsDiff): FindingRow[] {
  return [
    ...added.map((finding) => findingRow('New', finding)),
    ...resolved.map((finding) => findingRow('Resolved', finding)),
  ];
}
