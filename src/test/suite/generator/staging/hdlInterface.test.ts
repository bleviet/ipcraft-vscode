import {
  diffHdlInterface,
  findInterfaceRegion,
  hdlLanguageOf,
  syncInterfaceRegion,
} from '../../../../generator/staging/hdlInterface';

const vhdlCore = (extraPort: string, body: string): string =>
  `--------------------------------------------------------------------------------
-- Entity: foo_core
-- Description: Core logic module (bus-agnostic)
--------------------------------------------------------------------------------

library ieee;
use ieee.std_logic_1164.all;

use work.foo_pkg.all;

entity foo_core is
  generic (
    WIDTH : integer := 8
  );
  port (
    -- Clock and reset
    clk : in std_logic;
    rst : in std_logic;

    regs_in : in t_regs_sw2hw${extraPort ? ';' : ''}
${extraPort}  );
end entity foo_core;

architecture rtl of foo_core is
begin
${body}
end architecture rtl;
`;

const BUS_PORTS = `    -- m_axis (MASTER)
    m_axis_tdata  : out std_logic_vector(31 downto 0);
    m_axis_tvalid : out std_logic
`;

const svCore = (extraPort: string, body: string): string =>
  `// Description: Core logic module (bus-agnostic)
module foo_core import foo_pkg::*; #(
  parameter int WIDTH = 8
) (
  input  logic clk,
  input  logic rst,
  input  t_regs_sw2hw regs_in${extraPort ? ',' : ''}
${extraPort});
${body}
endmodule : foo_core
`;

const SV_BUS_PORTS = `  output logic [31:0] m_axis_tdata,
  output logic m_axis_tvalid
`;

describe('hdlLanguageOf', () => {
  it('maps extensions to languages', () => {
    expect(hdlLanguageOf('rtl/a.vhd')).toBe('vhdl');
    expect(hdlLanguageOf('rtl/a.VHDL')).toBe('vhdl');
    expect(hdlLanguageOf('rtl/a.sv')).toBe('verilog');
    expect(hdlLanguageOf('rtl/a.v')).toBe('verilog');
    expect(hdlLanguageOf('rtl/a.svh')).toBe('verilog');
    expect(hdlLanguageOf('rtl/a.vh')).toBe('verilog');
    expect(hdlLanguageOf('altera/a_hw.tcl')).toBeUndefined();
  });
});

describe('VHDL _core interface', () => {
  const current = vhdlCore('', '  user_logic <= clk;');
  const generated = vhdlCore(BUS_PORTS, '  -- generated body');

  it('lists ports added by a new bus interface', () => {
    expect(diffHdlInterface(current, generated, 'vhdl')).toEqual({
      added: ['m_axis_tdata', 'm_axis_tvalid'],
      removed: [],
      changed: [],
    });
  });

  it('reports removed and changed ports and generics', () => {
    const drift = diffHdlInterface(
      generated.replace('WIDTH : integer := 8', 'WIDTH : integer := 16'),
      current.replace('clk : in std_logic', 'clk : out std_logic'),
      'vhdl'
    );
    expect(drift).toEqual({
      added: [],
      removed: ['m_axis_tdata', 'm_axis_tvalid'],
      changed: ['clk', 'WIDTH'],
    });
  });

  it('returns undefined without differences or without an entity', () => {
    expect(diffHdlInterface(current, vhdlCore('', 'other body'), 'vhdl')).toBeUndefined();
    expect(diffHdlInterface('-- empty', '-- empty too', 'vhdl')).toBeUndefined();
  });

  it('finds the entity region up to the end of the entity', () => {
    const region = findInterfaceRegion(current, 'vhdl');
    expect(region).toBeDefined();
    const text = current.slice(region!.start, region!.end);
    expect(text.startsWith('entity foo_core is')).toBe(true);
    expect(text.endsWith('end entity foo_core;')).toBe(true);
  });

  it('ignores entity-like text in comments and rejects ambiguous files', () => {
    const commented = `-- entity bar is\n${current}`;
    expect(findInterfaceRegion(commented, 'vhdl')).toBeDefined();
    expect(findInterfaceRegion(`${current}\nentity other is\nend entity;`, 'vhdl')).toBeUndefined();
    expect(findInterfaceRegion('-- nothing', 'vhdl')).toBeUndefined();
  });

  it('syncs the new header and keeps the user architecture and context clauses', () => {
    const edited = current.replace(
      'use work.foo_pkg.all;',
      'use work.foo_pkg.all;\nuse work.mine.all;'
    );
    const synced = syncInterfaceRegion(edited, generated, 'vhdl');
    expect(synced).toBeDefined();
    expect(synced).toContain('m_axis_tvalid : out std_logic');
    expect(synced).toContain('use work.mine.all;');
    expect(synced).toContain('user_logic <= clk;');
    expect(synced).not.toContain('-- generated body');
    expect(diffHdlInterface(synced!, generated, 'vhdl')).toBeUndefined();
  });

  it('converts the inserted region to CRLF when the current file uses CRLF', () => {
    const crlf = current.replace(/\n/g, '\r\n');
    const synced = syncInterfaceRegion(crlf, generated, 'vhdl');
    expect(synced).toBeDefined();
    expect(synced).toContain('m_axis_tvalid : out std_logic');
    expect(synced!.replace(/\r\n/g, '')).not.toContain('\n');
    expect(synced).not.toContain('\r\r\n');
  });

  it('keeps a CRLF region as-is when both files use CRLF', () => {
    const crlf = current.replace(/\n/g, '\r\n');
    const synced = syncInterfaceRegion(crlf, generated.replace(/\n/g, '\r\n'), 'vhdl');
    expect(synced).toBeDefined();
    expect(synced).toContain('m_axis_tvalid : out std_logic');
    expect(synced).not.toContain('\r\r\n');
    expect(synced!.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('returns undefined when a region is missing', () => {
    expect(syncInterfaceRegion('-- none', generated, 'vhdl')).toBeUndefined();
    expect(syncInterfaceRegion(current, '-- none', 'vhdl')).toBeUndefined();
  });
});

describe('SystemVerilog _core interface', () => {
  const current = svCore('', '  assign user = clk;');
  const generated = svCore(SV_BUS_PORTS, '  // generated body');

  it('lists ports added by a new bus interface', () => {
    expect(diffHdlInterface(current, generated, 'verilog')).toEqual({
      added: ['m_axis_tdata', 'm_axis_tvalid'],
      removed: [],
      changed: [],
    });
  });

  it('finds the header through the import clause and #( ) parameters', () => {
    const region = findInterfaceRegion(current, 'verilog');
    expect(region).toBeDefined();
    const text = current.slice(region!.start, region!.end);
    expect(text.startsWith('module foo_core import foo_pkg::*; #(')).toBe(true);
    expect(text.endsWith('regs_in\n);')).toBe(true);
  });

  it('finds the header of a module without ports', () => {
    const text = 'module m; // header\nendmodule\n';
    expect(findInterfaceRegion(text, 'verilog')).toEqual({ start: 0, end: 9 });
  });

  it('syncs the new header and keeps the user body', () => {
    const synced = syncInterfaceRegion(current, generated, 'verilog');
    expect(synced).toContain('output logic m_axis_tvalid');
    expect(synced).toContain('assign user = clk;');
    expect(synced).not.toContain('generated body');
    expect(diffHdlInterface(synced!, generated, 'verilog')).toBeUndefined();
  });
});
