/** @jest-environment node */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  readComponentXml,
  readHwTcl,
  readIpYml,
  readQuartusAssignments,
  readXpr,
} from '../../../../services/vhdlLsConfig/sourceReaders';

const P = (...parts: string[]): string => path.resolve('/proj', ...parts);

describe('readXpr', () => {
  const xpr = (files: string): string =>
    `<?xml version="1.0"?><Project><FileSets>${files}</FileSets></Project>`;

  it('resolves $PPRDIR and $PSRCDIR and reads the Library attribute', () => {
    const text = xpr(`
      <FileSet Name="sources_1">
        <File Path="$PSRCDIR/sources_1/a.vhd"><FileInfo><Attr Name="Library" Val="Dsp_Lib"/></FileInfo></File>
        <File Path="$PPRDIR/../rtl/b.vhdl"/>
        <File Path="plain/c.vhd"><FileInfo><Attr Name="UsedIn" Val="synthesis"/></FileInfo></File>
        <File Path="$PSRCDIR/ip/x.xci"/>
      </FileSet>`);
    expect(readXpr(text, P('prj', 'my.xpr'))).toEqual({
      entries: [
        { file: P('prj', 'my.srcs', 'sources_1', 'a.vhd'), library: 'Dsp_Lib' },
        { file: P('rtl', 'b.vhdl'), library: 'defaultlib' },
        { file: P('prj', 'plain', 'c.vhd'), library: 'defaultlib' },
      ],
      unresolved: 0,
    });
  });

  it('counts other $ variables as unresolved', () => {
    const result = readXpr(xpr('<File Path="$XILINX/x.vhd"/>'), P('my.xpr'));
    expect(result).toEqual({ entries: [], unresolved: 1 });
  });

  it('does not throw on malformed XML', () => {
    expect(readXpr('<Project><File', P('my.xpr'))).toEqual({ entries: [], unresolved: 1 });
  });
});

describe('readQuartusAssignments', () => {
  it('reads VHDL_FILE assignments with flags in any order and defaults the library', () => {
    const text = [
      '# set_global_assignment -name VHDL_FILE commented.vhd',
      'set_global_assignment -name VHDL_FILE rtl/a.vhd -library my_lib',
      'set_global_assignment -library other -name VHDL_FILE "rtl/b.vhd"',
      'set_global_assignment -name VHDL_FILE c.vhd',
      'set_global_assignment -name VERILOG_FILE d.v',
      'set_global_assignment -name SDC_FILE e.sdc',
      'set_global_assignment -name TOP_LEVEL_ENTITY top',
    ].join('\n');
    expect(readQuartusAssignments(text, P('q', 'p.qsf'))).toEqual({
      entries: [
        { file: P('q', 'rtl', 'a.vhd'), library: 'my_lib' },
        { file: P('q', 'rtl', 'b.vhd'), library: 'other' },
        { file: P('q', 'c.vhd'), library: 'defaultlib' },
      ],
      unresolved: 0,
    });
  });

  it('resolves [file join $::quartus(qip_path) ...] against the qip directory', () => {
    const text =
      'set_global_assignment -name VHDL_FILE [file join $::quartus(qip_path) "sub/x.vhd"] -library lib\n' +
      'set_global_assignment -name VHDL_FILE [file join $::other(var) "y.vhd"]';
    expect(readQuartusAssignments(text, P('ip', 'core.qip'))).toEqual({
      entries: [{ file: P('ip', 'sub', 'x.vhd'), library: 'lib' }],
      unresolved: 1,
    });
  });
});

describe('readQuartusAssignments case', () => {
  it('matches the command, flags and VHDL_FILE case-insensitively', () => {
    const text = 'SET_GLOBAL_ASSIGNMENT -NAME vhdl_file a.vhd -LIBRARY lib';
    expect(readQuartusAssignments(text, P('q', 'p.qsf')).entries).toEqual([
      { file: P('q', 'a.vhd'), library: 'lib' },
    ]);
  });
});

describe('readComponentXml', () => {
  const NS = 'http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009';
  const xml = (files: string): string =>
    `<?xml version="1.0"?><spirit:component xmlns:spirit="${NS}"><spirit:fileSets><spirit:fileSet>${files}</spirit:fileSet></spirit:fileSets></spirit:component>`;

  it('reads file names with and without logicalName and skips URLs and non-VHDL', () => {
    const text = xml(`
      <spirit:file><spirit:name>hdl/a.vhd</spirit:name><spirit:logicalName>xil_defaultlib</spirit:logicalName></spirit:file>
      <spirit:file><spirit:name>hdl/b.vhd</spirit:name></spirit:file>
      <spirit:file><spirit:name>https://example.com/c.vhd</spirit:name></spirit:file>
      <spirit:file><spirit:name>hdl/d.v</spirit:name></spirit:file>`);
    expect(readComponentXml(text, P('ip', 'component.xml'))).toEqual({
      entries: [
        { file: P('ip', 'hdl', 'a.vhd'), library: 'xil_defaultlib' },
        { file: P('ip', 'hdl', 'b.vhd'), library: undefined },
      ],
      unresolved: 0,
    });
  });

  it('does not throw on malformed XML', () => {
    expect(readComponentXml('<a><b></a>', P('component.xml'))).toEqual({
      entries: [],
      unresolved: 1,
    });
  });
});

describe('readHwTcl', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hwtcl-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('reads add_fileset_file in a proc and in sourced scripts, ignoring comments', async () => {
    fs.writeFileSync(
      path.join(tmp, 'extra.tcl'),
      'add_fileset_file sub.vhd VHDL PATH sub/sub.vhd\n'
    );
    const file = path.join(tmp, 'core_hw.tcl');
    fs.writeFileSync(
      file,
      [
        '# add_fileset_file hidden.vhd VHDL PATH hidden.vhd',
        'proc synth {name} {',
        '  add_fileset_file top.vhd VHDL PATH rtl/top.vhd TOP_LEVEL_FILE',
        '  add_fileset_file v.v VERILOG PATH rtl/v.v',
        '  add_fileset_file j.vhd VHDL PATH [file join rtl j.vhd]',
        '  add_fileset_file u.vhd VHDL PATH $dir/u.vhd',
        '}',
        'source extra.tcl',
      ].join('\n')
    );
    const result = await readHwTcl(file);
    expect(result.entries.map((e) => e.file)).toEqual([
      path.join(tmp, 'rtl', 'top.vhd'),
      path.join(tmp, 'rtl', 'j.vhd'),
      path.join(tmp, 'sub', 'sub.vhd'),
    ]);
    expect(result.entries.every((e) => e.library === undefined)).toBe(true);
    expect(result.unresolved).toBe(1);
  });

  it('reports an unreadable file as unresolved', async () => {
    expect(await readHwTcl(path.join(tmp, 'missing_hw.tcl'))).toEqual({
      entries: [],
      unresolved: 1,
    });
  });
});

describe('readIpYml', () => {
  it('reads fileSets paths and logicalName', () => {
    const text = [
      'fileSets:',
      '  - name: RTL',
      '    files:',
      '      - path: rtl/a.vhd',
      '        logicalName: dsp_lib',
      '      - path: rtl/b.vhd',
      '      - path: doc/readme.md',
      '  - name: Empty',
    ].join('\n');
    expect(readIpYml(text, P('core', 'x.ip.yml'))).toEqual({
      entries: [
        { file: P('core', 'rtl', 'a.vhd'), library: 'dsp_lib' },
        { file: P('core', 'rtl', 'b.vhd'), library: undefined },
      ],
      unresolved: 0,
    });
  });

  it('does not throw on invalid YAML', () => {
    expect(readIpYml('a: [unclosed', P('x.ip.yml'))).toEqual({ entries: [], unresolved: 1 });
  });
});
