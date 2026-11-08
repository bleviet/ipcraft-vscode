/** Builds throw-away repositories for the vhdl_ls.toml generator tests (never committed as files). */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vhdl-ls-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const entity = (name: string, extra = ''): string => `${extra}entity ${name} is\nend entity;\n`;
const pkg = (name: string): string => `package ${name} is\nend package;\n`;

/** (a) One core described by an .ip.yml. */
export const SINGLE_CORE: Record<string, string> = {
  'core/core.ip.yml':
    'fileSets:\n  - name: RTL\n    files:\n      - path: rtl/top.vhd\n      - path: rtl/core_pkg.vhd\n',
  'core/rtl/top.vhd': entity(
    'top',
    'library ieee;\nuse ieee.std_logic_1164.all;\nuse work.core_pkg.all;\n'
  ),
  'core/rtl/core_pkg.vhd': pkg('core_pkg'),
};

/** (b) Several cores: a Vivado project with a Library attribute, an .ip.yml core, a shared package. */
export const MULTI_CORE: Record<string, string> = {
  'dsp/dsp.xpr':
    '<?xml version="1.0"?><Project><FileSets><FileSet Name="sources_1">' +
    '<File Path="$PPRDIR/src/fir_pkg.vhd"><FileInfo><Attr Name="Library" Val="dsp_lib"/></FileInfo></File>' +
    '</FileSet></FileSets></Project>',
  'dsp/src/fir_pkg.vhd': pkg('fir_pkg'),
  'ctrl/ctrl.ip.yml': 'fileSets:\n  - name: RTL\n    files:\n      - path: rtl/ctrl.vhd\n',
  'ctrl/rtl/ctrl.vhd': entity(
    'ctrl',
    'library dsp_lib;\nuse dsp_lib.fir_pkg.all;\nuse work.common_pkg.all;\nlibrary osvvm;\n'
  ),
  'common/common_pkg.vhd': pkg('common_pkg'),
};

/** (c) A .qsf naming only X.qsys; its generated copy must not collide with the real component. */
export const QSYS_COPY: Record<string, string> = {
  'proj/top.qsf':
    'set_global_assignment -name QSYS_FILE X.qsys\nset_global_assignment -name VHDL_FILE top.vhd\n',
  'proj/X.qsys': '<system/>',
  'proj/top.vhd': entity('top', 'library ieee;\nuse work.comp_pkg.all;\n'),
  'proj/X/synthesis/submodules/comp.vhd': pkg('comp_pkg'),
  'ip/comp/comp_hw.tcl':
    'add_fileset QUARTUS_SYNTH QUARTUS_SYNTH\nadd_fileset_file comp.vhd VHDL PATH rtl/comp.vhd\n',
  'ip/comp/rtl/comp.vhd': pkg('comp_pkg'),
};
