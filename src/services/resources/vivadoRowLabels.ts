/**
 * Labels of the four primary figures in the flat `report_utilization` table, the one
 * list read by both the resource view (`resourceMetrics`) and the build reports
 * (`ReportParser`). Vivado names the LUT and register rows by device family:
 * `Slice LUTs*` and `Slice Registers` on 7-series, `CLB LUTs*` and `CLB Registers`
 * on UltraScale and UltraScale+. Only total rows are listed, never their sub-rows
 * (`LUT as Logic`, `Register as Flip Flop`), which would undercount.
 */

export type VivadoPrimaryKey = 'lut' | 'ff' | 'bram' | 'dsp';

export const VIVADO_ROW_LABELS: Readonly<Record<VivadoPrimaryKey, readonly string[]>> = {
  lut: ['Slice LUTs', 'CLB LUTs'],
  ff: ['Slice Registers', 'CLB Registers'],
  bram: ['Block RAM Tile'],
  dsp: ['DSPs'],
};
