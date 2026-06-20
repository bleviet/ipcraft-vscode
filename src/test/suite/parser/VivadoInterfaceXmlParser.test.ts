import { parseVivadoInterfaceFiles } from '../../../parser/VivadoInterfaceXmlParser';

const SPIRIT_HEADER =
  'xmlns:xilinx="http://www.xilinx.com" xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

function busDefXml(opts: {
  vendor: string;
  library: string;
  name: string;
  version: string;
  description?: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<spirit:busDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>${opts.vendor}</spirit:vendor>
  <spirit:library>${opts.library}</spirit:library>
  <spirit:name>${opts.name}</spirit:name>
  <spirit:version>${opts.version}</spirit:version>
  ${opts.description ? `<spirit:description>${opts.description}</spirit:description>` : ''}
</spirit:busDefinition>`;
}

// Mirrors the real fifo_write_rtl.xml shape (verified against an actual Vivado 2024.2 install).
const FIFO_WRITE_RTL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:abstractionDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>fifo_write_rtl</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="fifo_write" spirit:version="1.0"/>
  <spirit:ports>
    <spirit:port>
      <spirit:logicalName>WR_DATA</spirit:logicalName>
      <spirit:wire>
        <spirit:onMaster>
          <spirit:presence>required</spirit:presence>
          <spirit:direction>out</spirit:direction>
        </spirit:onMaster>
        <spirit:onSlave>
          <spirit:presence>required</spirit:presence>
          <spirit:direction>in</spirit:direction>
        </spirit:onSlave>
      </spirit:wire>
    </spirit:port>
    <spirit:port>
      <spirit:logicalName>WR_EN</spirit:logicalName>
      <spirit:wire>
        <spirit:onMaster>
          <spirit:presence>required</spirit:presence>
          <spirit:width>1</spirit:width>
          <spirit:direction>out</spirit:direction>
        </spirit:onMaster>
        <spirit:onSlave>
          <spirit:presence>required</spirit:presence>
          <spirit:width>1</spirit:width>
          <spirit:direction>in</spirit:direction>
        </spirit:onSlave>
      </spirit:wire>
    </spirit:port>
    <spirit:port>
      <spirit:logicalName>FULL</spirit:logicalName>
      <spirit:wire>
        <spirit:onMaster>
          <spirit:presence>optional</spirit:presence>
          <spirit:width>1</spirit:width>
          <spirit:direction>in</spirit:direction>
        </spirit:onMaster>
        <spirit:onSlave>
          <spirit:presence>optional</spirit:presence>
          <spirit:width>1</spirit:width>
          <spirit:direction>out</spirit:direction>
        </spirit:onSlave>
      </spirit:wire>
    </spirit:port>
  </spirit:ports>
</spirit:abstractionDefinition>`;

const FIFO_WRITE_BUSDEF_XML = busDefXml({
  vendor: 'xilinx.com',
  library: 'interface',
  name: 'fifo_write',
  version: '1.0',
});

describe('parseVivadoInterfaceFiles', () => {
  it('joins a busDefinition with its abstractionDefinition into one resolved interface', () => {
    const result = parseVivadoInterfaceFiles([FIFO_WRITE_BUSDEF_XML, FIFO_WRITE_RTL_XML]);
    expect(result).toHaveLength(1);
    expect(result[0].busType).toEqual({
      vendor: 'xilinx.com',
      library: 'interface',
      name: 'fifo_write',
      version: '1.0',
    });
    expect(result[0].ports).toEqual([
      { name: 'WR_DATA', direction: 'out', presence: 'required' },
      { name: 'WR_EN', width: 1, direction: 'out', presence: 'required' },
      { name: 'FULL', width: 1, direction: 'in', presence: 'optional' },
    ]);
  });

  it('works regardless of file order', () => {
    const result = parseVivadoInterfaceFiles([FIFO_WRITE_RTL_XML, FIFO_WRITE_BUSDEF_XML]);
    expect(result).toHaveLength(1);
    expect(result[0].busType.name).toBe('fifo_write');
  });

  it('resolves multiple independent interfaces bundled across the same file set', () => {
    const fifoReadBusDef = busDefXml({
      vendor: 'xilinx.com',
      library: 'interface',
      name: 'fifo_read',
      version: '1.0',
    });
    const fifoReadRtl = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:abstractionDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>fifo_read_rtl</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="fifo_read" spirit:version="1.0"/>
  <spirit:ports>
    <spirit:port>
      <spirit:logicalName>RD_EN</spirit:logicalName>
      <spirit:wire>
        <spirit:onMaster>
          <spirit:presence>required</spirit:presence>
          <spirit:width>1</spirit:width>
          <spirit:direction>out</spirit:direction>
        </spirit:onMaster>
      </spirit:wire>
    </spirit:port>
  </spirit:ports>
</spirit:abstractionDefinition>`;

    const result = parseVivadoInterfaceFiles([
      FIFO_WRITE_BUSDEF_XML,
      FIFO_WRITE_RTL_XML,
      fifoReadBusDef,
      fifoReadRtl,
    ]);
    const names = result.map((r) => r.busType.name).sort();
    expect(names).toEqual(['fifo_read', 'fifo_write']);
  });

  it('skips a transactional-only (TLM) abstractionDefinition entirely', () => {
    const tlmXml = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:abstractionDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>aximm_tlm</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="aximm" spirit:version="1.0"/>
  <spirit:ports>
    <spirit:port>
      <spirit:logicalName>AXIMM_SOCKET</spirit:logicalName>
      <spirit:transactional>
        <spirit:onMaster>
          <spirit:presence>optional</spirit:presence>
        </spirit:onMaster>
      </spirit:transactional>
    </spirit:port>
  </spirit:ports>
</spirit:abstractionDefinition>`;
    const aximmBusDef = busDefXml({
      vendor: 'xilinx.com',
      library: 'interface',
      name: 'aximm',
      version: '1.0',
    });

    const result = parseVivadoInterfaceFiles([aximmBusDef, tlmXml]);
    expect(result).toHaveLength(0);
  });

  it('prefers a wire-based abstractionDefinition when both RTL and TLM target the same busType', () => {
    const tlmXml = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:abstractionDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>fifo_write_tlm</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busType spirit:vendor="xilinx.com" spirit:library="interface" spirit:name="fifo_write" spirit:version="1.0"/>
  <spirit:ports>
    <spirit:port>
      <spirit:logicalName>SOCKET</spirit:logicalName>
      <spirit:transactional>
        <spirit:onMaster><spirit:presence>optional</spirit:presence></spirit:onMaster>
      </spirit:transactional>
    </spirit:port>
  </spirit:ports>
</spirit:abstractionDefinition>`;

    const result = parseVivadoInterfaceFiles([FIFO_WRITE_BUSDEF_XML, tlmXml, FIFO_WRITE_RTL_XML]);
    expect(result).toHaveLength(1);
    expect(result[0].ports.map((p) => p.name)).toContain('WR_EN');
  });

  it('skips an abstractionDefinition whose busType was never found', () => {
    const result = parseVivadoInterfaceFiles([FIFO_WRITE_RTL_XML]);
    expect(result).toHaveLength(0);
  });

  it('skips a busDefinition missing required VLNV fields', () => {
    const incomplete = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:busDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>xilinx.com</spirit:vendor>
</spirit:busDefinition>`;
    const result = parseVivadoInterfaceFiles([incomplete, FIFO_WRITE_RTL_XML]);
    expect(result).toHaveLength(0);
  });

  it('skips non-standard Xilinx proprietary XML (e.g. parameterAbstractionDefinition) without crashing', () => {
    const proprietary = `<?xml version="1.0" encoding="UTF-8"?>
<xilinx:parameterAbstractionDefinition xmlns:xilinx="http://www.xilinx.com" xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">
  <spirit:vendor>xilinx.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>chi.param</spirit:name>
  <spirit:version>1.0</spirit:version>
</xilinx:parameterAbstractionDefinition>`;
    const result = parseVivadoInterfaceFiles([
      proprietary,
      FIFO_WRITE_BUSDEF_XML,
      FIFO_WRITE_RTL_XML,
    ]);
    expect(result).toHaveLength(1);
  });

  it('gracefully skips malformed XML without throwing', () => {
    expect(() =>
      parseVivadoInterfaceFiles([
        'not xml at all',
        '<unclosed',
        FIFO_WRITE_BUSDEF_XML,
        FIFO_WRITE_RTL_XML,
      ])
    ).not.toThrow();
    const result = parseVivadoInterfaceFiles([
      'not xml at all',
      '<unclosed',
      FIFO_WRITE_BUSDEF_XML,
      FIFO_WRITE_RTL_XML,
    ]);
    expect(result).toHaveLength(1);
  });

  it('omits width entirely for an unconstrained/parameterized port (e.g. data width)', () => {
    const result = parseVivadoInterfaceFiles([FIFO_WRITE_BUSDEF_XML, FIFO_WRITE_RTL_XML]);
    const wrData = result[0].ports.find((p) => p.name === 'WR_DATA');
    expect(wrData?.width).toBeUndefined();
  });

  it('returns an empty array for no input', () => {
    expect(parseVivadoInterfaceFiles([])).toEqual([]);
  });
});
