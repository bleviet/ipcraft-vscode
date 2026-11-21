/**
 * Reader for the "... Resource Utilization by Entity" table of a Quartus
 * `.map.rpt` or `.fit.rpt`. Cells read `total (self)` or just `total`. The tree
 * comes from the Full Hierarchy Name column (`|top|sys:u0|sys_pio_0:pio_0`), whose
 * components are `entity:instance`; the top component has no colon.
 */

import type { ParsedTable, ReportNode } from './reportTree';

const TITLE = /^;\s*.*Resource Utilization by Entity\b/;
const NODE_COLUMN = 'Compilation Hierarchy Node';
const PATH_COLUMN = 'Full Hierarchy Name';
const NON_NUMERIC_COLUMNS = [NODE_COLUMN, PATH_COLUMN, 'Entity Name', 'Library Name'];

function splitCells(line: string): string[] {
  return line
    .trim()
    .replace(/^;/, '')
    .replace(/;$/, '')
    .split(';')
    .map((cell) => cell.trim());
}

/** `120.5 (6.4)` is total 120.5 and self 6.4; `65536` is a total with no self figure. */
function parseCell(cell: string): { total: number; self?: number } {
  const m = /^(-?[\d,.]+)(?:\s*\(\s*(-?[\d,.]+)\s*\))?$/.exec(cell);
  const toNumber = (s: string) => Number(s.replace(/,/g, ''));
  if (!m) {
    return { total: 0 };
  }
  return m[2] === undefined
    ? { total: toNumber(m[1]) }
    : { total: toNumber(m[1]), self: toNumber(m[2]) };
}

function toNode(component: string, isTop: boolean): Pick<ReportNode, 'name' | 'module'> {
  const colon = component.indexOf(':');
  if (isTop || colon < 0) {
    return { name: component, module: component };
  }
  return { name: component.slice(colon + 1), module: component.slice(0, colon) };
}

export function parseQuartusEntities(text: string): ParsedTable {
  const lines = text.split(/\r?\n/);
  const titleAt = lines.findIndex((line) => TITLE.test(line));
  const empty: ParsedTable = { columns: [], root: { name: '', total: [], children: [] } };
  if (titleAt < 0) {
    return empty;
  }
  const headerAt = lines.findIndex(
    (line, index) => index > titleAt && splitCells(line).includes(NODE_COLUMN)
  );
  if (headerAt < 0) {
    return empty;
  }
  const header = splitCells(lines[headerAt]);
  const pathAt = header.indexOf(PATH_COLUMN);
  const numericAt = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !NON_NUMERIC_COLUMNS.includes(name));
  if (pathAt < 0) {
    return empty;
  }

  let root: ReportNode | undefined;
  const byPath = new Map<string, ReportNode>();
  for (const line of lines.slice(headerAt + 1)) {
    if (!line.startsWith(';')) {
      if (line.startsWith('+') && root) {
        break;
      }
      continue;
    }
    const cells = splitCells(line);
    const path = cells[pathAt];
    if (!path) {
      continue;
    }
    const components = path.split('|').slice(1);
    const parsed = numericAt.map(({ index }) => parseCell(cells[index] ?? ''));
    const node: ReportNode = {
      ...toNode(components[components.length - 1], components.length === 1),
      total: parsed.map((p) => p.total),
      children: [],
    };
    if (parsed.some((p) => p.self !== undefined)) {
      node.self = parsed.map((p) => p.self ?? null);
    }
    byPath.set(path, node);
    if (components.length === 1) {
      root ??= node;
      continue;
    }
    byPath.get(`|${components.slice(0, -1).join('|')}`)?.children.push(node);
  }
  if (!root) {
    return empty;
  }
  return { columns: numericAt.map(({ name }) => name), root };
}
