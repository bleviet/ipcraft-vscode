/**
 * Recognizes Vivado block design Tcl scripts (`write_bd_tcl` output or
 * hand-written equivalents) and Platform Designer `.qsys` systems.
 */

const BD_COMMAND = /\bcreate_bd_(?:design|cell)\b/;
const QSYS_SYSTEM = /<system[\s>]/;

export function isSystemDesignScript(fileName: string, text: string): boolean {
  if (fileName.endsWith('.qsys')) {
    return QSYS_SYSTEM.test(text);
  }
  return fileName.endsWith('.tcl') && !fileName.endsWith('_hw.tcl') && BD_COMMAND.test(text);
}
