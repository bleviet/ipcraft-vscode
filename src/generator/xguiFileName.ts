/**
 * File-name form of an IP core version for the Vivado XGUI script (`xgui/<name>_v<suffix>.tcl`).
 * Free-text versions can hold characters that are illegal in file names, so every character
 * outside [A-Za-z0-9_] becomes `_` (`1.2.0` -> `1_2_0`, `rev A/1` -> `rev_A_1`).
 */
export function xguiVersionSuffix(version: string): string {
  return version.replace(/[^A-Za-z0-9_]/g, '_');
}
