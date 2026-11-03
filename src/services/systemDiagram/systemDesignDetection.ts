/**
 * Recognizes Vivado block design Tcl scripts (`write_bd_tcl` output or
 * hand-written equivalents). Platform Designer detection is out of scope.
 */

const BD_COMMAND = /\bcreate_bd_(?:design|cell)\b/;

export function isSystemDesignScript(fileName: string, text: string): boolean {
  return fileName.endsWith('.tcl') && !fileName.endsWith('_hw.tcl') && BD_COMMAND.test(text);
}
