/**
 * Recognizes Vivado block design Tcl scripts (`write_bd_tcl` output or
 * hand-written equivalents), Vivado JSON `.bd` files (XML `.bd` files of
 * Vivado 2018.2 and earlier are accepted too, so the reader can explain they
 * are unsupported), Platform Designer `qsys-script` Tcl and Platform Designer
 * `.qsys` systems.
 */

const QSYS_SYSTEM = /<system[\s>]/;

/** Vivado block design commands; wins over {@link QSYS_TCL_PATTERN} when both match. */
export const BD_TCL_PATTERN = /\bcreate_bd_(?:design|cell)\b/;
const BD_JSON_PATTERN = /"design"\s*:/;
const QSYS_TCL_PATTERN = /\b(?:create_system|add_instance)\b/;

export function isSystemDesignScript(fileName: string, text: string): boolean {
  if (fileName.endsWith('.qsys')) {
    return QSYS_SYSTEM.test(text);
  }
  if (fileName.endsWith('.bd')) {
    return BD_JSON_PATTERN.test(text) || text.trimStart().startsWith('<');
  }
  return (
    fileName.endsWith('.tcl') &&
    !fileName.endsWith('_hw.tcl') &&
    (BD_TCL_PATTERN.test(text) || QSYS_TCL_PATTERN.test(text))
  );
}
