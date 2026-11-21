/**
 * Where a design (or an IP core's top entity) appears in a parsed report table. Pure; shared by the
 * mapping onto a graph and by the recognition of a build of one IP core on its own.
 */

import type { ResourceVendor } from '../../domain/resourceUsage';
import type { ParsedTable, ReportNode } from './reportTree';

export interface Candidate {
  /** Report path: `sys_wrapper/sys_i` (Vivado), `|top|sys:u0` (Quartus). */
  path: string;
  node: ReportNode;
}

export function reportPath(vendor: ResourceVendor, chain: ReportNode[]): string {
  if (vendor === 'vivado') {
    return chain.map((node) => node.name).join('/');
  }
  return `|${chain.map((node, i) => (i === 0 ? node.name : `${node.module}:${node.name}`)).join('|')}`;
}

/** Every row whose module is the design (Vivado `sys`, Quartus entity `sys`). */
export function findCandidates(
  table: ParsedTable,
  vendor: ResourceVendor,
  design: string
): Candidate[] {
  const found: Candidate[] = [];
  const visit = (node: ReportNode, chain: ReportNode[]): void => {
    const here = [...chain, node];
    if (node.module === design) {
      found.push({ path: reportPath(vendor, here), node });
    }
    node.children.forEach((child) => visit(child, here));
  };
  visit(table.root, []);
  return found;
}
