import {
  extractVhdlDependencies,
  extractSvDependencies,
  sortByCompilationOrder,
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

  it('ignores ieee and other external libraries', () => {
    const content = `
      library ieee;
      use ieee.std_logic_1164.all;
      use ieee.numeric_std.all;
    `;
    const { uses } = extractVhdlDependencies(content);
    expect(uses.size).toBe(0);
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
