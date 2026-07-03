import { WidthFunctionName } from '../../../shared/widthExprAst';

export interface WidthFunctionHelpEntry {
  signature: string;
  description: string;
  example: string;
}

/**
 * Reference text for every predefined width-expression function, shown in the
 * WidthField help popover. Typed as a `Record` over `WidthFunctionName` (not a
 * plain array) so the grammar in widthExprAst.ts and this help text cannot
 * silently drift apart — adding a function without an entry here is a compile
 * error.
 */
export const WIDTH_FUNCTION_HELP: Record<WidthFunctionName, WidthFunctionHelpEntry> = {
  clog2: {
    signature: 'clog2(x)',
    description: 'Ceiling of log2(x); matches SystemVerilog $clog2',
    example: 'clog2(FIFO_DEPTH)',
  },
  log2: {
    signature: 'log2(x)',
    description: 'Floor of log2(x). Not supported in SystemVerilog generation (VHDL/Tcl only).',
    example: 'log2(DEPTH)',
  },
  ceil: {
    signature: 'ceil(x)',
    description: 'Round up to the nearest integer',
    example: 'ceil(WIDTH/8)',
  },
  floor: {
    signature: 'floor(x)',
    description: 'Round down to the nearest integer',
    example: 'floor(WIDTH/8)',
  },
  abs: {
    signature: 'abs(x)',
    description: 'Absolute value',
    example: 'abs(OFFSET)',
  },
  min: {
    signature: 'min(x, y)',
    description: 'Smaller of two values. Not supported in IP-XACT (component.xml) export.',
    example: 'min(A, B)',
  },
  max: {
    signature: 'max(x, y)',
    description: 'Larger of two values. Not supported in IP-XACT (component.xml) export.',
    example: 'max(A, B)',
  },
};

/** Note appended below the per-function list in the help popover. */
export const WIDTH_EXPR_OPERATORS_NOTE =
  'Expressions also support + - * / operators, parentheses for grouping, and ' +
  'referencing any integer parameter by name (e.g. AxiDataWidth_g/8).';
