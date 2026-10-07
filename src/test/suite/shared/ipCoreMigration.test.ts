import * as yaml from 'yaml';
import { migrateIpCoreYaml } from '../../../shared/ipCoreFormat';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const library = builtinBusLibrary();

function legacyAvalon(): string {
  return `# Leading comment
apiVersion: '1.0'
vlnv:
  vendor: acme
  library: demo
  name: core
  version: 1.0.0
busInterfaces:
  - name: avalon # trailing comment
    type: ${BUS_VLNV.AVALON_MM}
    mode: master
    useOptionalPorts: [byteenable_n, readdatavalid_n, waitrequest_n, read_n, write_n]
    portWidthOverrides:
      read_n: 1
      address: 0x20
    portNameOverrides:
      write_n: my_write_n
`;
}

describe('migrateIpCoreYaml', () => {
  it('canonicalizes legacy Avalon-MM polarity names into portPolarityOverrides', () => {
    const result = migrateIpCoreYaml(legacyAvalon(), library);

    expect(result.changed).toBe(true);
    expect(result).toMatchObject({ fromVersion: '1.0', toVersion: '1.1' });
    expect(result.mutationCount).toBeGreaterThan(1);
    expect((yaml.parse(result.text) as { apiVersion: string }).apiVersion).toBe('1.1');
    const bus = (yaml.parse(result.text) as { busInterfaces: Array<Record<string, unknown>> })
      .busInterfaces[0];
    expect(bus.useOptionalPorts).toEqual([
      'byteenable',
      'readdatavalid',
      'waitrequest',
      'read',
      'write',
    ]);
    expect(bus.portPolarityOverrides).toMatchObject({
      byteenable: 'activeLow',
      readdatavalid: 'activeLow',
      waitrequest: 'activeLow',
      read: 'activeLow',
      write: 'activeLow',
    });
    expect(bus.portWidthOverrides).not.toHaveProperty('read_n');
    expect(bus.portNameOverrides).not.toHaveProperty('write_n');
    expect(bus.portNameOverrides).toHaveProperty('write', 'my_write_n');
  });

  it('preserves comments and hex literals', () => {
    const { text } = migrateIpCoreYaml(legacyAvalon(), library);
    expect(text).toContain('# Leading comment');
    expect(text).toContain('# trailing comment');
    expect(text).toContain('0x20');
  });

  it('is idempotent', () => {
    const first = migrateIpCoreYaml(legacyAvalon(), library);
    const second = migrateIpCoreYaml(first.text, library);
    expect(second).toEqual({
      text: first.text,
      changed: false,
      fromVersion: '1.1',
      toVersion: '1.1',
      mutationCount: 0,
    });
  });

  it('stamps apiVersion on a file that declares none, even without bus interfaces', () => {
    const source = '# nothing here\nclocks: []\n';
    const result = migrateIpCoreYaml(source, library);
    expect(result).toMatchObject({
      changed: true,
      fromVersion: '1.0',
      toVersion: '1.1',
      mutationCount: 1,
    });
    expect(yaml.parse(result.text)).toEqual({ clocks: [], apiVersion: '1.1' });
    expect(result.text).toContain('# nothing here');
  });

  it('leaves a 1.1 file unchanged, even with legacy content (the editor handles that)', () => {
    const source = legacyAvalon().replace("apiVersion: '1.0'", "apiVersion: '1.1'");
    expect(migrateIpCoreYaml(source, library)).toEqual({
      text: source,
      changed: false,
      fromVersion: '1.1',
      toVersion: '1.1',
      mutationCount: 0,
    });
  });

  it('throws a clear error for a newer format version', () => {
    expect(() => migrateIpCoreYaml("apiVersion: '1.2'\nclocks: []\n", library)).toThrow(
      /apiVersion 1\.2.*up to 1\.1/
    );
  });

  it('throws on invalid YAML', () => {
    expect(() => migrateIpCoreYaml('a: [unclosed', library)).toThrow();
  });

  it('throws on a non-object document', () => {
    expect(() => migrateIpCoreYaml('- a\n- b\n', library)).toThrow('must be an object');
    expect(() => migrateIpCoreYaml('', library)).toThrow('must be an object');
  });
});

describe('migrateIpCoreYaml apiVersion placement', () => {
  it('inserts a single-quoted apiVersion right after vlnv, keeping comments and hex', () => {
    const source = `# header
vlnv:
  vendor: acme
  library: demo
  name: core
  version: 1.0.0

# the clocks
clocks:
  - name: clk
parameters:
  - name: A
    value: 0x20
`;
    const { text } = migrateIpCoreYaml(source, library);
    expect(text).toBe(
      source.replace('  version: 1.0.0\n', "  version: 1.0.0\napiVersion: '1.1'\n")
    );
  });

  it('inserts at the top when there is no vlnv', () => {
    expect(migrateIpCoreYaml('clocks: []\n', library).text).toBe("apiVersion: '1.1'\nclocks: []\n");
  });

  it('edits an existing apiVersion in place', () => {
    const { text } = migrateIpCoreYaml("clocks: []\napiVersion: '1.0'\nports: []\n", library);
    expect(text).toBe("clocks: []\napiVersion: '1.1'\nports: []\n");
  });
});

describe('migrateIpCoreYaml formatting preservation', () => {
  const source = `vlnv:
  vendor: acme
  library: demo
  name: core
  version: 1.0.0
ports:
- name: x
  direction: in
  width: 0x0010
  reset: 0xFF
`;

  it('changes only the apiVersion line (hex spellings and flush sequences kept)', () => {
    const { text } = migrateIpCoreYaml(source, library);
    expect(text).toBe(
      source.replace('  version: 1.0.0\n', "  version: 1.0.0\napiVersion: '1.1'\n")
    );
  });

  it('keeps formatting when editing an existing apiVersion in place', () => {
    const { text } = migrateIpCoreYaml(`apiVersion: '1.0'\n${source}`, library);
    expect(text).toBe(`apiVersion: '1.1'\n${source}`);
  });
});

describe('migrateIpCoreYaml legacy snake_case keys', () => {
  const legacyKeys = `apiVersion: '1.1'
vlnv:
  vendor: acme
  library: demo
  name: core
  version: 1.0.0
file_sets:
  - name: rtl # keep
busInterfaces:
  - name: s_axi
    type: ${BUS_VLNV.AXI4_LITE}
    mode: slave
    physical_prefix: s_axi_ # prefix
    associated_clock: clk
`;

  it('renames legacy keys in a file already at the latest apiVersion', () => {
    const result = migrateIpCoreYaml(legacyKeys, library);
    expect(result).toMatchObject({
      changed: true,
      fromVersion: '1.1',
      toVersion: '1.1',
      mutationCount: 3,
    });
    expect(result.text).toContain('fileSets:');
    expect(result.text).toContain('physicalPrefix: s_axi_ # prefix');
    expect(result.text).toContain('associatedClock: clk');
    expect(result.text).not.toMatch(/file_sets|physical_prefix|associated_clock/);
  });

  it('renames before running the version steps and counts the renames', () => {
    const result = migrateIpCoreYaml(legacyKeys.replace("'1.1'", "'1.0'"), library);
    expect(result).toMatchObject({ changed: true, fromVersion: '1.0', toVersion: '1.1' });
    expect(result.mutationCount).toBeGreaterThanOrEqual(4);
    expect(result.text).toContain("apiVersion: '1.1'");
    expect(result.text).not.toMatch(/file_sets|physical_prefix|associated_clock/);
  });

  describe('dotted bus type VLNVs', () => {
    const dottedCore = (
      types: [string, string],
      apiVersion = '1.0'
    ): string => `apiVersion: '${apiVersion}'
vlnv:
  vendor: acme
  library: demo
  name: core
  version: 1.0.0
busInterfaces:
  - name: S_AXI
    type: ${types[0]} # bus type
    mode: slave
    memoryMapRef: MY_MAP
  - name: s_axis_in
    type: ${types[1]}
    mode: slave
`;

    it('rewrites dotted types to the canonical colon form and stays idempotent', () => {
      const result = migrateIpCoreYaml(
        dottedCore(['ipcraft.busif.axi4_lite.1.0', 'ipcraft.busif.axi_stream.1.0']),
        library
      );
      const buses = (yaml.parse(result.text) as { busInterfaces: Array<{ type: string }> })
        .busInterfaces;
      expect(buses.map((b) => b.type)).toEqual([BUS_VLNV.AXI4_LITE, BUS_VLNV.AXI_STREAM]);
      expect(result.mutationCount).toBe(3);
      expect(result.text).toContain('# bus type');

      const again = migrateIpCoreYaml(result.text, library);
      expect(again.changed).toBe(false);
      expect(again.text).toBe(result.text);
    });

    it('rewrites dotted types in a file already at the latest version', () => {
      const result = migrateIpCoreYaml(
        dottedCore(['ipcraft.busif.axi4_lite.1.0', 'ipcraft.busif.axi_stream.1.0'], '1.1'),
        library
      );
      const buses = (yaml.parse(result.text) as { busInterfaces: Array<{ type: string }> })
        .busInterfaces;
      expect(buses.map((b) => b.type)).toEqual([BUS_VLNV.AXI4_LITE, BUS_VLNV.AXI_STREAM]);
      expect(result).toMatchObject({
        changed: true,
        fromVersion: '1.1',
        toVersion: '1.1',
        mutationCount: 2,
      });
      expect(result.text).toContain('# bus type');

      const again = migrateIpCoreYaml(result.text, library);
      expect(again.changed).toBe(false);
      expect(again.text).toBe(result.text);
    });

    it('leaves a dotted type unchanged when its colon form does not resolve', () => {
      const result = migrateIpCoreYaml(
        dottedCore(['acme.busif.unknown.1.0', 'ipcraft.busif.axi_stream.1.0']),
        library
      );
      expect(result.text).toContain('type: acme.busif.unknown.1.0');
      expect(result.text).toContain(`type: ${BUS_VLNV.AXI_STREAM}`);
    });
  });
});
