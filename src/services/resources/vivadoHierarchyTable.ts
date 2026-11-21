/**
 * Reader for the "Utilization by Hierarchy" table of `report_utilization
 * -hierarchical`. The tree is encoded in the Instance cell (two leading spaces
 * per level); a `(name)` row is the logic of its parent cell itself. Columns are
 * taken from the header row by text.
 */

import type { ParsedTable, ReportNode } from './reportTree';

const NON_NUMERIC_COLUMNS = ['Instance', 'Module'];
const SELF_ROW = /^\((.*)\)$/;

function splitCells(line: string): string[] {
  return line.slice(line.indexOf('|') + 1, line.lastIndexOf('|')).split('|');
}

function toNumber(cell: string): number {
  const value = Number(cell.trim().replace(/,/g, ''));
  return Number.isNaN(value) ? 0 : value;
}

/** Depth of an Instance cell: one padding space, then two spaces per level. */
function depthOf(cell: string): number {
  const indent = cell.length - cell.trimStart().length;
  return Math.max(0, Math.floor((indent - 1) / 2));
}

export function parseVivadoHierarchy(text: string): ParsedTable {
  const lines = text.split(/\r?\n/).filter((line) => line.trimStart().startsWith('|'));
  const headerAt = lines.findIndex((line) => {
    const names = splitCells(line).map((cell) => cell.trim());
    return names.includes('Instance') && names.includes('Module');
  });
  const empty: ParsedTable = { columns: [], root: { name: '', total: [], children: [] } };
  if (headerAt < 0) {
    return empty;
  }
  const header = splitCells(lines[headerAt]).map((cell) => cell.trim());
  const instanceAt = header.indexOf('Instance');
  const moduleAt = header.indexOf('Module');
  const numericAt = header
    .map((name, index) => ({ name, index }))
    .filter(({ name }) => !NON_NUMERIC_COLUMNS.includes(name));

  let root: ReportNode | undefined;
  const stack: ReportNode[] = [];
  for (const line of lines.slice(headerAt + 1)) {
    const cells = splitCells(line);
    const name = cells[instanceAt]?.trim();
    if (!name) {
      continue;
    }
    const values = numericAt.map(({ index }) => toNumber(cells[index] ?? ''));
    const depth = depthOf(cells[instanceAt]);
    const selfRow = SELF_ROW.test(name);
    const parent = stack[depth - 1];
    if (selfRow) {
      if (parent) {
        parent.self = values;
      }
      continue;
    }
    const node: ReportNode = {
      name,
      module: cells[moduleAt]?.trim() || undefined,
      total: values,
      children: [],
    };
    if (depth === 0) {
      root ??= node;
    } else if (parent) {
      parent.children.push(node);
    } else {
      continue;
    }
    stack.length = depth;
    stack[depth] = node;
  }
  if (!root) {
    return empty;
  }
  return { columns: numericAt.map(({ name }) => name), root };
}
