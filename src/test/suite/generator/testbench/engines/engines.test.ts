import { GhdlEngine } from '../../../../../generator/testbench/engines/GhdlEngine';
import { IcarusEngine } from '../../../../../generator/testbench/engines/IcarusEngine';
import { VerilatorEngine } from '../../../../../generator/testbench/engines/VerilatorEngine';
import { QuestaEngine } from '../../../../../generator/testbench/engines/QuestaEngine';

describe('GhdlEngine', () => {
  const e = new GhdlEngine();
  it('has expected id and metadata', () => {
    expect(e.id).toBe('ghdl');
    expect(e.simVar).toBe('ghdl');
    expect(e.topLevelLang).toBe('vhdl');
    expect(e.waveExt).toBe('ghw');
  });
  it('compileArgs include VHDL-2008 and relaxed flags', () => {
    expect(e.compileArgs).toContain('--std=08');
    expect(e.compileArgs).toContain('-frelaxed');
  });
  it('simArgs produce wave file arg for the given entity', () => {
    expect(e.simArgs('my_core')).toContain('--wave=my_core.ghw');
  });
  it('waveArgs produce the ghw wave flag', () => {
    expect(e.waveArgs('my_core')).toContain('--wave=my_core.ghw');
  });
  it('VUnit option keys are ghdl.* prefixed', () => {
    expect(e.vunitSimOptionKey).toMatch(/^ghdl\./);
    expect(e.vunitCompileOptionKey).toMatch(/^ghdl\./);
  });
});

describe('IcarusEngine', () => {
  const e = new IcarusEngine();
  it('has expected id and metadata', () => {
    expect(e.id).toBe('icarus');
    expect(e.simVar).toBe('icarus');
    expect(e.topLevelLang).toBe('verilog');
    expect(e.waveExt).toBe('vcd');
  });
  it('compileArgs include SystemVerilog 2012 flag', () => {
    expect(e.compileArgs).toContain('-g2012');
  });
  it('simArgs returns empty array (Icarus handles waves via dump.v)', () => {
    expect(e.simArgs('core')).toEqual([]);
  });
});

describe('VerilatorEngine', () => {
  const e = new VerilatorEngine();
  it('has expected id and metadata', () => {
    expect(e.id).toBe('verilator');
    expect(e.simVar).toBe('verilator');
    expect(e.topLevelLang).toBe('verilog');
    expect(e.waveExt).toBe('fst');
  });
  it('compileArgs include --sv and trace flags', () => {
    expect(e.compileArgs).toContain('--sv');
    expect(e.compileArgs).toContain('--trace-fst');
    expect(e.compileArgs).toContain('-Wno-fatal');
  });
});

describe('QuestaEngine', () => {
  const e = new QuestaEngine();
  it('has expected id and metadata', () => {
    expect(e.id).toBe('questa');
    expect(e.simVar).toBe('questa');
    expect(e.topLevelLang).toBe('vhdl');
    expect(e.waveExt).toBe('wlf');
  });
  it('compileArgs include VHDL-2008 flag', () => {
    expect(e.compileArgs).toContain('-2008');
  });
  it('simArgs include run-all-and-quit sequence', () => {
    const args = e.simArgs('core');
    expect(args.join(' ')).toContain('run -all');
  });
  it('VUnit option keys are modelsim.* prefixed', () => {
    expect(e.vunitSimOptionKey).toMatch(/^modelsim\./);
    expect(e.vunitCompileOptionKey).toMatch(/^modelsim\./);
  });
  it('waveArgs split flag and value into separate elements', () => {
    expect(e.waveArgs('my_core')).toEqual(['-wlf', 'my_core.wlf']);
  });
});
