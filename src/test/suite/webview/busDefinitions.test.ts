import { lookupBusDef } from '../../../webview/ipcore/data/busDefinitions';
import { BUS_VLNV } from '../../../shared/busVlnv';

function portNames(ports: { name: string }[] | null): string[] {
  return (ports ?? []).map((p) => p.name);
}

describe('lookupBusDef', () => {
  describe('Avalon-MM', () => {
    it('resolves the IPCraft Avalon-MM VLNV to the Avalon-MM port list', () => {
      const ports = lookupBusDef(BUS_VLNV.AVALON_MM);
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('address');
      expect(portNames(ports)).toContain('writedata');
      expect(portNames(ports)).toContain('readdata');
    });

    it('resolves the Vivado-emitted "xilinx.com:interface:avalon:1.0" VLNV (issue #8)', () => {
      const ports = lookupBusDef('xilinx.com:interface:avalon:1.0');
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('address');
      expect(portNames(ports)).toContain('writedata');
    });
  });

  describe('Avalon-ST (must not collapse to Avalon-MM)', () => {
    it('resolves the IPCraft Avalon-ST VLNV to the Avalon-ST port list', () => {
      const ports = lookupBusDef(BUS_VLNV.AVALON_ST);
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('data');
      expect(portNames(ports)).toContain('valid');
      expect(portNames(ports)).not.toContain('address');
    });

    it('resolves the Altera streaming VLNV to the Avalon-ST port list', () => {
      const ports = lookupBusDef('altera.com:interface:avalon_streaming:19.1');
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('data');
      expect(portNames(ports)).not.toContain('address');
    });
  });

  describe('AXI families', () => {
    it('resolves AXI4-Lite', () => {
      const ports = lookupBusDef(BUS_VLNV.AXI4_LITE);
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('AWADDR');
    });

    it('resolves AXI4-Full', () => {
      const ports = lookupBusDef(BUS_VLNV.AXI4_FULL);
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('AWLEN');
    });

    it('resolves AXI-Stream', () => {
      const ports = lookupBusDef(BUS_VLNV.AXI_STREAM);
      expect(ports).not.toBeNull();
      expect(portNames(ports)).toContain('TDATA');
    });
  });

  describe('conduit and unknown', () => {
    it('returns an empty port list for a conduit', () => {
      const ports = lookupBusDef(BUS_VLNV.CONDUIT);
      expect(ports).toEqual([]);
    });

    it('returns null for an unknown custom interface', () => {
      expect(lookupBusDef('user:busif:xcvr:1.0')).toBeNull();
    });
  });
});
