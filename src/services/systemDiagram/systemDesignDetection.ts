/**
 * Recognizes Vivado block design Tcl scripts (`write_bd_tcl` output or
 * hand-written equivalents), Platform Designer `qsys-script` Tcl and
 * Platform Designer `.qsys` systems.
 */

const QSYS_SYSTEM = /<system[\s>]/;

/** Vivado block design commands; wins over {@link QSYS_TCL_PATTERN} when both match. */
export const BD_TCL_PATTERN = /\bcreate_bd_(?:design|cell)\b/;
const QSYS_TCL_PATTERN = /\b(?:create_system|add_instance)\b/;

export function isSystemDesignScript(fileName: string, text: string): boolean {
  if (fileName.endsWith('.qsys')) {
    return QSYS_SYSTEM.test(text);
  }
  return (
    fileName.endsWith('.tcl') &&
    !fileName.endsWith('_hw.tcl') &&
    (BD_TCL_PATTERN.test(text) || QSYS_TCL_PATTERN.test(text))
  );
}
