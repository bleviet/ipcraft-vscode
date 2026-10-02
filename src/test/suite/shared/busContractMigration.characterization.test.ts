import { canonicalizeBusInterfacePorts, canonicalizeBusType } from '../../../shared/busContracts';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { builtinBusLibrary } from '../../helpers/busLibrary';

type LegacyPortSignature = readonly [
  name: string,
  width: number,
  direction: 'in' | 'out' | null,
  presence: 'required' | 'optional',
  role: 'clock' | 'reset' | 'control' | 'data' | 'byteQualifier',
];

const LEGACY_AXI_PORTS: Record<'AXI4_LITE' | 'AXI4_FULL' | 'AXI_STREAM', LegacyPortSignature[]> = {
  AXI4_LITE: [
    ['ACLK', 1, null, 'required', 'clock'],
    ['ARESETn', 1, null, 'required', 'reset'],
    ['AWADDR', 32, 'out', 'required', 'control'],
    ['AWVALID', 1, 'out', 'required', 'control'],
    ['AWREADY', 1, 'in', 'required', 'control'],
    ['AWPROT', 3, 'out', 'required', 'control'],
    ['WDATA', 32, 'out', 'required', 'data'],
    ['WSTRB', 4, 'out', 'required', 'byteQualifier'],
    ['WVALID', 1, 'out', 'required', 'control'],
    ['WREADY', 1, 'in', 'required', 'control'],
    ['BRESP', 2, 'in', 'required', 'control'],
    ['BVALID', 1, 'in', 'required', 'control'],
    ['BREADY', 1, 'out', 'required', 'control'],
    ['ARADDR', 32, 'out', 'required', 'control'],
    ['ARVALID', 1, 'out', 'required', 'control'],
    ['ARREADY', 1, 'in', 'required', 'control'],
    ['ARPROT', 3, 'out', 'required', 'control'],
    ['RDATA', 32, 'in', 'required', 'data'],
    ['RRESP', 2, 'in', 'required', 'control'],
    ['RVALID', 1, 'in', 'required', 'control'],
    ['RREADY', 1, 'out', 'required', 'control'],
  ],
  AXI4_FULL: [
    ['ACLK', 1, null, 'required', 'clock'],
    ['ARESETn', 1, null, 'required', 'reset'],
    ['AWID', 4, 'out', 'optional', 'control'],
    ['AWADDR', 32, 'out', 'required', 'control'],
    ['AWVALID', 1, 'out', 'required', 'control'],
    ['AWREADY', 1, 'in', 'required', 'control'],
    ['AWPROT', 3, 'out', 'required', 'control'],
    ['AWLEN', 8, 'out', 'optional', 'control'],
    ['AWSIZE', 3, 'out', 'optional', 'control'],
    ['AWBURST', 2, 'out', 'optional', 'control'],
    ['AWLOCK', 1, 'out', 'optional', 'control'],
    ['AWCACHE', 4, 'out', 'optional', 'control'],
    ['WDATA', 32, 'out', 'required', 'data'],
    ['WSTRB', 4, 'out', 'required', 'byteQualifier'],
    ['WLAST', 1, 'out', 'optional', 'control'],
    ['WVALID', 1, 'out', 'required', 'control'],
    ['WREADY', 1, 'in', 'required', 'control'],
    ['BID', 4, 'in', 'optional', 'control'],
    ['BRESP', 2, 'in', 'required', 'control'],
    ['BVALID', 1, 'in', 'required', 'control'],
    ['BREADY', 1, 'out', 'required', 'control'],
    ['ARID', 4, 'out', 'optional', 'control'],
    ['ARADDR', 32, 'out', 'required', 'control'],
    ['ARVALID', 1, 'out', 'required', 'control'],
    ['ARREADY', 1, 'in', 'required', 'control'],
    ['ARPROT', 3, 'out', 'required', 'control'],
    ['ARLEN', 8, 'out', 'optional', 'control'],
    ['ARSIZE', 3, 'out', 'optional', 'control'],
    ['ARBURST', 2, 'out', 'optional', 'control'],
    ['ARLOCK', 1, 'out', 'optional', 'control'],
    ['ARCACHE', 4, 'out', 'optional', 'control'],
    ['RID', 4, 'in', 'optional', 'control'],
    ['RDATA', 32, 'in', 'required', 'data'],
    ['RRESP', 2, 'in', 'required', 'control'],
    ['RLAST', 1, 'in', 'optional', 'control'],
    ['RVALID', 1, 'in', 'required', 'control'],
    ['RREADY', 1, 'out', 'required', 'control'],
  ],
  AXI_STREAM: [
    ['ACLK', 1, null, 'required', 'clock'],
    ['ARESETn', 1, null, 'required', 'reset'],
    ['TDATA', 32, 'out', 'required', 'data'],
    ['TVALID', 1, 'out', 'required', 'control'],
    ['TREADY', 1, 'in', 'required', 'control'],
    ['TSTRB', 4, 'out', 'optional', 'byteQualifier'],
    ['TKEEP', 4, 'out', 'optional', 'byteQualifier'],
    ['TLAST', 1, 'out', 'optional', 'control'],
    ['TID', 8, 'out', 'optional', 'control'],
    ['TDEST', 4, 'out', 'optional', 'control'],
    ['TUSER', 1, 'out', 'optional', 'control'],
  ],
};

const LEGACY_AVALON_MM_PORT_NAMES = [
  'clk',
  'reset',
  'address',
  'read',
  'write',
  'byteenable',
  'chipselect',
  'writedata',
  'readdata',
  'readdatavalid',
  'waitrequest',
  'burstcount',
  'beginbursttransfer',
  'response',
];

const ALIASES = {
  AXI4_LITE: ['AXI4L', 'AXI4LITE', 'AXILITE', 'AXIL', 'axi4_lite', 'axi4-lite'],
  AXI4_FULL: ['AXI4F', 'AXI4FULL', 'AXI4', 'axi4_full', 'axi4-full'],
  AXI_STREAM: ['AXI4S', 'AXISTREAM', 'AXIS', 'axi_stream', 'axi-stream'],
  AVALON_MEMORY_MAPPED: [
    'AVMM',
    'AVALONMM',
    'AVALONMEMORYMAPPED',
    'AVALON_MEMORY_MAPPED',
    'avalon_mm',
    'avalon-mm',
    'avalon_memory',
    'xilinx.com:interface:avalon:1.0',
    'xilinx.com:interface:avalon-mm:2.0',
  ],
  AVALON_STREAMING: [
    'AVST',
    'AVALONST',
    'AVALONSTREAMING',
    'avalon_st',
    'avalon-st',
    'avalon_stream',
    'xilinx.com:interface:avalon-st:1.0',
    'altera.com:interface:avalon_streaming:19.1',
  ],
} as const;

const CANONICAL_BY_KEY = {
  AXI4_LITE: BUS_VLNV.AXI4_LITE,
  AXI4_FULL: BUS_VLNV.AXI4_FULL,
  AXI_STREAM: BUS_VLNV.AXI_STREAM,
  AVALON_MEMORY_MAPPED: BUS_VLNV.AVALON_MM,
  AVALON_STREAMING: BUS_VLNV.AVALON_ST,
} as const;

describe('bus contract migration characterization', () => {
  const library = builtinBusLibrary();

  it.each(Object.entries(ALIASES))('%s retains the complete alias closure', (key, aliases) => {
    for (const alias of aliases) {
      expect(canonicalizeBusType(alias, library)?.canonicalVlnv).toBe(
        CANONICAL_BY_KEY[key as keyof typeof CANONICAL_BY_KEY]
      );
    }
  });

  it.each(['AXI4_LITE', 'AXI4_FULL', 'AXI_STREAM'] as const)(
    '%s preserves the characterized hard-coded port contract',
    (key) => {
      const canonical = library.definitions[key].ports.map((port) => {
        return [
          port.name,
          port.width ?? 1,
          port.direction ?? null,
          port.presence,
          port.role,
        ] as LegacyPortSignature;
      });
      expect(canonical).toEqual(LEGACY_AXI_PORTS[key]);
    }
  );

  it('names the intentional canonical Avalon-MM port-set delta', () => {
    const canonical = library.definitions.AVALON_MEMORY_MAPPED.ports.map((port) => port.name);
    expect(canonical).toEqual([
      'clk',
      'reset',
      'address',
      'read',
      'write',
      'byteenable',
      'debugaccess',
      'lock',
      'writedata',
      'readdata',
      'readdatavalid',
      'writeresponsevalid',
      'waitrequest',
      'response',
      'burstcount',
      'beginbursttransfer',
    ]);
    expect(LEGACY_AVALON_MM_PORT_NAMES.filter((name) => !canonical.includes(name))).toEqual([
      'chipselect',
    ]);
    expect(canonical.filter((name) => !LEGACY_AVALON_MM_PORT_NAMES.includes(name))).toEqual([
      'debugaccess',
      'lock',
      'writeresponsevalid',
    ]);
  });

  it('canonicalizes each legacy Avalon-MM polarity role to one port identity', () => {
    const contract = library.definitions.AVALON_MEMORY_MAPPED;
    const result = canonicalizeBusInterfacePorts(
      contract,
      {
        name: 'avalon',
        type: contract.canonicalVlnv,
        mode: 'master',
        useOptionalPorts: ['byteenable_n', 'readdatavalid_n', 'waitrequest_n', 'read_n', 'write_n'],
      },
      0
    );

    expect(result.busInterface.useOptionalPorts).toEqual([
      'byteenable',
      'readdatavalid',
      'waitrequest',
      'read',
      'write',
    ]);
    expect(result.busInterface.portPolarityOverrides).toEqual({
      byteenable: 'activeLow',
      readdatavalid: 'activeLow',
      waitrequest: 'activeLow',
      read: 'activeLow',
      write: 'activeLow',
    });
  });
});
