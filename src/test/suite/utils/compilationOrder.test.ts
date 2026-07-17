import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractVhdlDependencies,
  extractSvDependencies,
  sortByCompilationOrder,
  hdlLanguageFromPath,
  resolveFileSetRtlFiles,
} from '../../../utils/compilationOrder';

// ── VHDL extraction ───────────────────────────────────────────────────────────

describe('extractVhdlDependencies', () => {
  it('detects a package declaration', () => {
    const { declares } = extractVhdlDependencies('package foo_pkg is\nend package;');
    expect(declares).toContain('foo_pkg');
  });

  it('detects an entity declaration', () => {
    const { declares } = extractVhdlDependencies('entity my_core is\nend entity;');
    expect(declares).toContain('my_core');
  });

  it('detects a use work clause', () => {
    const { uses } = extractVhdlDependencies('use work.foo_pkg.all;');
    expect(uses).toContain('foo_pkg');
  });

  it('strips only the first segment after work.', () => {
    const { uses } = extractVhdlDependencies('use work.bar_pkg.MY_CONST;');
    expect(uses).toContain('bar_pkg');
    expect(uses).not.toContain('my_const');
  });

  it('records use-clause unit names regardless of library alias', () => {
    // Matching against declared units happens downstream in topoSort's
    // declMap, so extraction itself doesn't need to know which aliases are
    // real project libraries vs. vendor ones (ieee, a named library like
    // `neorv32`, etc.) — see the 'ignores references to libraries with no
    // matching declared unit' test below for the actual no-false-edge proof.
    const content = `
      library ieee;
      use ieee.std_logic_1164.all;
      use ieee.numeric_std.all;
    `;
    const { uses } = extractVhdlDependencies(content);
    expect(uses).toContain('std_logic_1164');
    expect(uses).toContain('numeric_std');
  });

  it('detects use clauses through a named (non-work) library alias', () => {
    // Real-world professionally-packaged VHDL IP often compiles into a named
    // library instead of `work` (e.g. NEORV32: `library neorv32; use
    // neorv32.neorv32_package.all;`), not just `use work.X`.
    const { uses } = extractVhdlDependencies('use neorv32.neorv32_package.all;');
    expect(uses).toContain('neorv32_package');
  });

  it('detects direct entity instantiation as a dependency', () => {
    // `label: entity <library>.<entity>` inside an architecture body is a
    // real compile-order dependency in GHDL (the target entity must be
    // analysed first), distinct from the `entity NAME is` declaration form.
    const content = `
      architecture rtl of top is
      begin
        u_core: entity work.my_core
          port map (clk => clk);
      end architecture;
    `;
    const { uses } = extractVhdlDependencies(content);
    expect(uses).toContain('my_core');
  });

  it('is case-insensitive for VHDL keywords', () => {
    const content = `
      PACKAGE Foo_Pkg IS
      USE WORK.Bar_Pkg.ALL;
    `;
    const { declares, uses } = extractVhdlDependencies(content);
    expect(declares).toContain('foo_pkg');
    expect(uses).toContain('bar_pkg');
  });

  it('strips inline comments before matching', () => {
    const { declares, uses } = extractVhdlDependencies(
      'package foo_pkg is  -- declared here\n' + 'use work.baz_pkg.all; -- needed\n'
    );
    expect(declares).toContain('foo_pkg');
    expect(uses).toContain('baz_pkg');
  });

  it('handles multiple declarations in one file', () => {
    const content = `
      package types_pkg is
      end package;
      entity top is
      end entity;
    `;
    const { declares } = extractVhdlDependencies(content);
    expect(declares).toContain('types_pkg');
    expect(declares).toContain('top');
  });
});

// ── SystemVerilog extraction ──────────────────────────────────────────────────

describe('extractSvDependencies', () => {
  it('detects a package declaration', () => {
    const { declares } = extractSvDependencies('package foo_pkg;\nendpackage');
    expect(declares).toContain('foo_pkg');
  });

  it('detects a module declaration', () => {
    const { declares } = extractSvDependencies('module my_core (input logic clk);');
    expect(declares).toContain('my_core');
  });

  it('detects an import statement', () => {
    const { uses } = extractSvDependencies('import foo_pkg::*;');
    expect(uses).toContain('foo_pkg');
  });

  it('detects a port-list import (module-level import)', () => {
    const content = `
      module my_core
        import foo_pkg::bar;
      (input logic clk);
    `;
    const { uses } = extractSvDependencies(content);
    expect(uses).toContain('foo_pkg');
  });

  it('strips single-line comments', () => {
    const { declares } = extractSvDependencies('module my_mod // the top module\n(input clk);');
    expect(declares).toContain('my_mod');
  });

  it('strips block comments', () => {
    const content = '/* preamble */ module my_mod(input clk);';
    const { declares } = extractSvDependencies(content);
    expect(declares).toContain('my_mod');
  });

  it('is case-sensitive', () => {
    const { declares: d1 } = extractSvDependencies('package FooPkg;');
    const { declares: d2 } = extractSvDependencies('package foopkg;');
    expect(d1).toContain('FooPkg');
    expect(d1).not.toContain('foopkg');
    expect(d2).toContain('foopkg');
  });

  it('detects a `define macro declaration, including function-like macros', () => {
    const { declares } = extractSvDependencies("`define OPCODE_BKP 4'b0000");
    expect(declares).toContain('OPCODE_BKP');

    const { declares: fn } = extractSvDependencies('`define MAX(a, b) ((a) > (b) ? (a) : (b))');
    expect(fn).toContain('MAX');
  });

  it('detects a bare macro reference as a use', () => {
    const content = 'assign hit = instr[3:0] == `OPCODE_BKP;';
    const { uses } = extractSvDependencies(content);
    expect(uses).toContain('OPCODE_BKP');
  });

  it('does not treat compiler directives (`include, `ifdef, etc.) as macro uses', () => {
    const content = `
      \`include "foo.v"
      \`ifdef SIMULATION
      \`endif
      \`timescale 1ns/1ps
    `;
    const { uses } = extractSvDependencies(content);
    expect(uses.size).toBe(0);
  });

  it("does not double-count a `define line's own macro name as a use of itself", () => {
    const { uses } = extractSvDependencies('`define FOO 1');
    expect(uses.size).toBe(0);
  });
});

// ── sortByCompilationOrder ────────────────────────────────────────────────────

const noRead = async (_p: string): Promise<null> => null;

function makeReader(map: Record<string, string>) {
  return async (p: string): Promise<string | null> => map[p] ?? null;
}

describe('sortByCompilationOrder', () => {
  it('returns single item unchanged', async () => {
    const result = await sortByCompilationOrder([{ path: 'a.vhd', language: 'vhdl' }], noRead);
    expect(result).toEqual(['a.vhd']);
  });

  it('puts a package before the entity that uses it', async () => {
    const reader = makeReader({
      '/pkg.vhd': 'package foo_pkg is\nend package;',
      '/top.vhd': 'use work.foo_pkg.all;\nentity top is\nend entity;',
    });

    // Supply in wrong order: top first, pkg second
    const result = await sortByCompilationOrder(
      [
        { path: '/top.vhd', language: 'vhdl' },
        { path: '/pkg.vhd', language: 'vhdl' },
      ],
      reader
    );

    expect(result.indexOf('/pkg.vhd')).toBeLessThan(result.indexOf('/top.vhd'));
  });

  it('preserves order when files are already correct', async () => {
    const reader = makeReader({
      '/pkg.vhd': 'package foo_pkg is\nend package;',
      '/top.vhd': 'use work.foo_pkg.all;\nentity top is\nend entity;',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/pkg.vhd', language: 'vhdl' },
        { path: '/top.vhd', language: 'vhdl' },
      ],
      reader
    );

    expect(result).toEqual(['/pkg.vhd', '/top.vhd']);
  });

  it('puts a package before a consumer that references it through a named (non-work) library', async () => {
    // Reproduces a real NEORV32-style project layout: the package compiles
    // into a project-named library, not `work`, and consumers write
    // `use neorv32.neorv32_package.all;` instead of `use work....`.
    const reader = makeReader({
      '/pkg.vhd': 'package neorv32_package is\nend package;',
      '/top.vhd': 'library neorv32;\nuse neorv32.neorv32_package.all;\nentity top is\nend entity;',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/top.vhd', language: 'vhdl' },
        { path: '/pkg.vhd', language: 'vhdl' },
      ],
      reader
    );

    expect(result.indexOf('/pkg.vhd')).toBeLessThan(result.indexOf('/top.vhd'));
  });

  it('orders sub-entities before a top file that directly instantiates them', async () => {
    // Direct entity instantiation (`label: entity lib.name`) is a real GHDL
    // analysis-order dependency distinct from package use-clauses — a common
    // pattern in multi-entity designs (e.g. a CPU top file instantiating its
    // ALU/regfile/LSU sub-entities).
    const reader = makeReader({
      '/alu.vhd': 'entity my_alu is\nend entity;',
      '/regfile.vhd': 'entity my_regfile is\nend entity;',
      '/top.vhd': `entity top is
        end entity;
        architecture rtl of top is
        begin
          u_alu: entity work.my_alu port map (clk => clk);
          u_regfile: entity work.my_regfile port map (clk => clk);
        end architecture;`,
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/top.vhd', language: 'vhdl' },
        { path: '/alu.vhd', language: 'vhdl' },
        { path: '/regfile.vhd', language: 'vhdl' },
      ],
      reader
    );

    expect(result.indexOf('/alu.vhd')).toBeLessThan(result.indexOf('/top.vhd'));
    expect(result.indexOf('/regfile.vhd')).toBeLessThan(result.indexOf('/top.vhd'));
  });

  it('ignores references to libraries with no matching declared unit in the batch', async () => {
    // A `use ieee.std_logic_1164.all;` (or any vendor/external library
    // reference) must not create a false dependency edge just because
    // extraction no longer special-cases `work` — it should only ever match
    // a unit actually declared by one of the files being sorted.
    const reader = makeReader({
      '/a.vhd': 'library ieee;\nuse ieee.std_logic_1164.all;\nentity a is\nend entity;',
      '/b.vhd': 'library ieee;\nuse ieee.numeric_std.all;\nentity b is\nend entity;',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/b.vhd', language: 'vhdl' },
        { path: '/a.vhd', language: 'vhdl' },
      ],
      reader
    );

    // No real dependency between a.vhd and b.vhd — original relative order preserved.
    expect(result).toEqual(['/b.vhd', '/a.vhd']);
  });

  it('orders a plain-Verilog `define`-only header before a file that bare-references its macro', async () => {
    // Reproduces a real oldland-cpu-style layout: no SV packages, no `include —
    // a shared header of `define constants and a consumer that relies on it
    // being compiled earlier in the file list (language: 'verilog', not 'systemverilog').
    const reader = makeReader({
      '/defs.v': "`define OPCODE_BKP 4'b0000\n",
      '/decode.v':
        'module decode(input [3:0] opc, output hit);\n' +
        'assign hit = opc == `OPCODE_BKP;\n' +
        'endmodule\n',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/decode.v', language: 'verilog' },
        { path: '/defs.v', language: 'verilog' },
      ],
      reader
    );

    expect(result.indexOf('/defs.v')).toBeLessThan(result.indexOf('/decode.v'));
  });

  it('handles a three-level dependency chain', async () => {
    const reader = makeReader({
      '/types.vhd': 'package types_pkg is\nend package;',
      '/regs.vhd': 'use work.types_pkg.all;\npackage regs_pkg is\nend package;',
      '/top.vhd': 'use work.regs_pkg.all;\nuse work.types_pkg.all;\nentity top is\nend entity;',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/top.vhd', language: 'vhdl' },
        { path: '/regs.vhd', language: 'vhdl' },
        { path: '/types.vhd', language: 'vhdl' },
      ],
      reader
    );

    expect(result.indexOf('/types.vhd')).toBeLessThan(result.indexOf('/regs.vhd'));
    expect(result.indexOf('/regs.vhd')).toBeLessThan(result.indexOf('/top.vhd'));
  });

  it('preserves relative order of independent files', async () => {
    const reader = makeReader({
      '/pkg.vhd': 'package foo_pkg is\nend package;',
      '/core.vhd': 'use work.foo_pkg.all;\nentity core is\nend entity;',
      '/wrapper.vhd': 'use work.foo_pkg.all;\nentity wrapper is\nend entity;',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/pkg.vhd', language: 'vhdl' },
        { path: '/core.vhd', language: 'vhdl' },
        { path: '/wrapper.vhd', language: 'vhdl' },
      ],
      reader
    );

    // pkg must come first; core and wrapper are independent of each other
    expect(result[0]).toBe('/pkg.vhd');
    expect(result).toContain('/core.vhd');
    expect(result).toContain('/wrapper.vhd');
  });

  it('falls back to original order on circular dependency', async () => {
    const reader = makeReader({
      '/a.vhd': 'package a_pkg is\nend package;\nuse work.b_pkg.all;',
      '/b.vhd': 'package b_pkg is\nend package;\nuse work.a_pkg.all;',
    });

    const original = ['/a.vhd', '/b.vhd'];
    const result = await sortByCompilationOrder(
      original.map((p) => ({ path: p, language: 'vhdl' })),
      reader
    );

    expect(result).toEqual(original);
  });

  it('treats unreadable files as having no dependencies', async () => {
    const reader = makeReader({
      '/pkg.vhd': 'package foo_pkg is\nend package;',
      // '/top.vhd' is not in the map → returns null
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/top.vhd', language: 'vhdl' },
        { path: '/pkg.vhd', language: 'vhdl' },
      ],
      reader
    );

    // No deps detected for top.vhd (unreadable) → original order preserved
    expect(result).toHaveLength(2);
  });

  it('uses inline content when provided, skipping the reader', async () => {
    const readerCalled: string[] = [];
    const reader = async (p: string): Promise<string | null> => {
      readerCalled.push(p);
      return null;
    };

    await sortByCompilationOrder(
      [
        {
          path: '/pkg.vhd',
          language: 'vhdl',
          content: 'package foo_pkg is\nend package;',
        },
      ],
      reader
    );

    expect(readerCalled).toHaveLength(0);
  });

  it('sorts SystemVerilog packages before modules that import them', async () => {
    const reader = makeReader({
      '/top.sv': 'module top\nimport types_pkg::*;\n(input logic clk);',
      '/types.sv': 'package types_pkg;\nendpackage',
    });

    const result = await sortByCompilationOrder(
      [
        { path: '/top.sv', language: 'systemverilog' },
        { path: '/types.sv', language: 'systemverilog' },
      ],
      reader
    );

    expect(result.indexOf('/types.sv')).toBeLessThan(result.indexOf('/top.sv'));
  });

  it('passes non-HDL files through without reordering', async () => {
    const reader = makeReader({});
    const result = await sortByCompilationOrder(
      [
        { path: '/top.vhd', language: 'vhdl', content: 'entity top is\nend entity;' },
        { path: '/timing.sdc', language: 'sdc' },
      ],
      reader
    );

    expect(result).toContain('/top.vhd');
    expect(result).toContain('/timing.sdc');
  });
});

// ── hdlLanguageFromPath ────────────────────────────────────────────────────────

describe('hdlLanguageFromPath', () => {
  it('resolves .vhd to vhdl', () => {
    expect(hdlLanguageFromPath('rtl/foo.vhd')).toBe('vhdl');
  });

  it('resolves .vhdl to vhdl', () => {
    expect(hdlLanguageFromPath('rtl/foo.vhdl')).toBe('vhdl');
  });

  it('resolves .sv to systemverilog', () => {
    expect(hdlLanguageFromPath('rtl/foo.sv')).toBe('systemverilog');
  });

  it('resolves .svh to systemverilog', () => {
    expect(hdlLanguageFromPath('rtl/foo_pkg.svh')).toBe('systemverilog');
  });

  it('resolves .v to verilog', () => {
    expect(hdlLanguageFromPath('rtl/foo.v')).toBe('verilog');
  });

  it('resolves .vh to verilog', () => {
    expect(hdlLanguageFromPath('rtl/foo_defs.vh')).toBe('verilog');
  });

  it('is case-insensitive', () => {
    expect(hdlLanguageFromPath('rtl/FOO.VHD')).toBe('vhdl');
  });

  it('returns undefined for an unrecognized extension', () => {
    expect(hdlLanguageFromPath('constraints/timing.sdc')).toBeUndefined();
  });
});

// ── resolveFileSetRtlFiles ───────────────────────────────────────────────────

describe('resolveFileSetRtlFiles', () => {
  let tmp: string;

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  function writeFile(relPath: string, content: string) {
    const full = path.join(tmp, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  it('returns an empty array when the named fileSet is absent', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resolve-fileset-'));
    const result = await resolveFileSetRtlFiles({ fileSets: [] }, tmp, 'RTL_Sources');
    expect(result).toEqual([]);
  });

  it('sorts real VHDL content into dependency order regardless of declared order', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resolve-fileset-order-'));
    writeFile(
      'rtl/main_logic.vhd',
      ['use work.weird_types_pkg.all;', 'entity main_logic is', 'end entity main_logic;'].join('\n')
    );
    writeFile(
      'rtl/weird_types.vhd',
      ['package weird_types_pkg is', 'end package weird_types_pkg;'].join('\n')
    );

    const ipCoreData = {
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/main_logic.vhd', type: 'vhdl' },
            { path: 'rtl/weird_types.vhd', type: 'vhdl' },
          ],
        },
      ],
    };

    const result = await resolveFileSetRtlFiles(ipCoreData, tmp, 'RTL_Sources');
    expect(result.map((f) => f.path)).toEqual(['rtl/weird_types.vhd', 'rtl/main_logic.vhd']);
  });

  it('includes type: verilog entries rather than dropping them', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resolve-fileset-verilog-'));
    writeFile('rtl/pkg.vhd', 'package foo_pkg is\nend package foo_pkg;');
    writeFile('rtl/legacy.v', 'module legacy(input clk);\nendmodule\n');

    const ipCoreData = {
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/legacy.v', type: 'verilog' },
            { path: 'rtl/pkg.vhd', type: 'vhdl' },
          ],
        },
      ],
    };

    const result = await resolveFileSetRtlFiles(ipCoreData, tmp, 'RTL_Sources');
    expect(result.map((f) => f.path)).toEqual(
      expect.arrayContaining(['rtl/legacy.v', 'rtl/pkg.vhd'])
    );
    expect(result).toHaveLength(2);
    expect(result.find((f) => f.path === 'rtl/legacy.v')?.type).toBe('verilog');
  });

  it('parses real module/`define` dependencies for type: verilog entries (plain Verilog, not just SystemVerilog)', async () => {
    // Reproduces a real oldland-cpu-style layout: a shared `define`-only header
    // referenced by bare macro (not `` `include ``) from a plain .v consumer file.
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resolve-fileset-verilog-macro-'));
    writeFile('rtl/defs.v', "`define OPCODE_BKP 4'b0000\n");
    writeFile(
      'rtl/decode.v',
      'module decode(input [3:0] opc, output hit);\n' +
        'assign hit = opc == `OPCODE_BKP;\n' +
        'endmodule\n'
    );

    const ipCoreData = {
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/decode.v', type: 'verilog' },
            { path: 'rtl/defs.v', type: 'verilog' },
          ],
        },
      ],
    };

    const result = await resolveFileSetRtlFiles(ipCoreData, tmp, 'RTL_Sources');
    const paths = result.map((f) => f.path);
    expect(paths.indexOf('rtl/defs.v')).toBeLessThan(paths.indexOf('rtl/decode.v'));
  });

  it('rescues a missing type from the file extension', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resolve-fileset-rescue-'));
    writeFile('rtl/pkg.vhd', 'package foo_pkg is\nend package foo_pkg;');
    writeFile('rtl/top.vhd', 'use work.foo_pkg.all;\nentity top is\nend entity top;');

    const ipCoreData = {
      fileSets: [
        {
          name: 'RTL_Sources',
          // No `type` field at all — must be rescued via the .vhd extension.
          files: [{ path: 'rtl/top.vhd' }, { path: 'rtl/pkg.vhd' }],
        },
      ],
    };

    const result = await resolveFileSetRtlFiles(ipCoreData, tmp, 'RTL_Sources');
    expect(result.map((f) => f.path)).toEqual(['rtl/pkg.vhd', 'rtl/top.vhd']);
  });

  it('treats an unreadable file as dependency-free rather than throwing', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resolve-fileset-missing-'));
    // Declared but never written to disk.
    const ipCoreData = {
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/ghost.vhd', type: 'vhdl' }],
        },
      ],
    };

    const result = await resolveFileSetRtlFiles(ipCoreData, tmp, 'RTL_Sources');
    expect(result.map((f) => f.path)).toEqual(['rtl/ghost.vhd']);
  });
});
