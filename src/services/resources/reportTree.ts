/**
 * Vendor-neutral report tree shared by the Vivado and Quartus table readers and
 * by the mapping onto the system graph. Pure data, no behavior.
 */

export interface ReportNode {
  /** Vivado: the Instance cell. Quartus: the instance part of `entity:instance`. */
  name: string;
  /** Vivado: the Module cell. Quartus: the entity of `entity:instance`. */
  module?: string;
  /** One value per {@link ParsedTable.columns} entry. */
  total: number[];
  /**
   * The node's own logic, aligned with `total`. Vivado: the `(name)` row. Quartus:
   * the value in parentheses; `null` marks a column whose cell has a single
   * value, for which the report gives no self figure. Absent when the report has
   * no self figure for the node.
   */
  self?: Array<number | null>;
  children: ReportNode[];
}

export interface ParsedTable {
  /** Numeric columns, as written in the report header. */
  columns: string[];
  root: ReportNode;
}
