import { checkPackRequirements } from '../../../generator/contract';
import type { ScaffoldPack, ScaffoldPackRequirements } from '../../../generator/types';

function makePack(requirements?: ScaffoldPackRequirements): ScaffoldPack {
  return { name: 'avalon-pack', packDir: '/tmp/avalon-pack', files: [], requirements };
}

const compatibleInput = {
  hdlLanguage: 'vhdl' as const,
  busType: 'avmm',
  hasMemoryMappedSlave: true,
  activeBusPortNames: ['address', 'read', 'write', 'writedata', 'readdata'],
};

describe('checkPackRequirements', () => {
  it('passes when the pack declares no requirements', () => {
    expect(() => checkPackRequirements(makePack(), compatibleInput)).not.toThrow();
  });

  it('passes when every declared requirement is met', () => {
    const pack = makePack({
      hdlLanguages: ['vhdl'],
      busTypes: ['avmm'],
      memoryMappedSlave: 'required',
      minimumBusPorts: ['address', 'read', 'write', 'writedata', 'readdata'],
    });
    expect(() => checkPackRequirements(pack, compatibleInput)).not.toThrow();
  });

  it('rejects an incompatible HDL language', () => {
    const pack = makePack({ hdlLanguages: ['vhdl'] });
    expect(() =>
      checkPackRequirements(pack, { ...compatibleInput, hdlLanguage: 'systemverilog' })
    ).toThrow(/requires HDL language \[vhdl\], but generation targets 'systemverilog'/);
  });

  it("rejects an AXI4-Lite IP core against an Avalon-MM-only pack (issue #152's example)", () => {
    const pack = makePack({ busTypes: ['avmm'] });
    expect(() => checkPackRequirements(pack, { ...compatibleInput, busType: 'axil' })).toThrow(
      /requires bus type \[avmm\], but the IP core's primary slave interface is 'axil'/
    );
  });

  it('rejects a core with no memory-mapped slave when one is required', () => {
    const pack = makePack({ memoryMappedSlave: 'required' });
    expect(() =>
      checkPackRequirements(pack, { ...compatibleInput, hasMemoryMappedSlave: false })
    ).toThrow(/requires a memory-mapped slave interface, but the IP core has none/);
  });

  it('rejects a core with a memory-mapped slave when one is forbidden', () => {
    const pack = makePack({ memoryMappedSlave: 'forbidden' });
    expect(() =>
      checkPackRequirements(pack, { ...compatibleInput, hasMemoryMappedSlave: true })
    ).toThrow(/requires no memory-mapped slave interface, but the IP core has one/);
  });

  it('rejects an Avalon-MM interface with no active optional ports enabled', () => {
    // Regression scenario: every avalon_mm port is presence:optional, so an interface with no
    // useOptionalPorts renders with zero signals — a register-file template has nothing through
    // which software can access the registers.
    const pack = makePack({
      minimumBusPorts: ['address', 'read', 'write', 'writedata', 'readdata'],
    });
    expect(() =>
      checkPackRequirements(pack, { ...compatibleInput, activeBusPortNames: [] })
    ).toThrow(
      /requires bus ports \[address, read, write, writedata, readdata\], but the primary bus interface is missing: address, read, write, writedata, readdata/
    );
  });

  it('matches bus port names case-insensitively', () => {
    const pack = makePack({ minimumBusPorts: ['ADDRESS'] });
    expect(() =>
      checkPackRequirements(pack, { ...compatibleInput, activeBusPortNames: ['address'] })
    ).not.toThrow();
  });

  it('reports every unmet requirement in a single error', () => {
    const pack = makePack({
      hdlLanguages: ['systemverilog'],
      busTypes: ['axil'],
      memoryMappedSlave: 'forbidden',
    });
    let error: Error | undefined;
    try {
      checkPackRequirements(pack, compatibleInput);
    } catch (err) {
      error = err as Error;
    }
    expect(error?.message).toContain("Scaffold pack 'avalon-pack' is incompatible");
    expect(error?.message).toContain('requires HDL language');
    expect(error?.message).toContain('requires bus type');
    expect(error?.message).toContain('requires no memory-mapped slave interface');
  });
});
