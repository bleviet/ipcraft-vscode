import * as yaml from 'yaml';
import { migrateIpCoreYaml } from '../../../shared/ipCoreFormat';
import { BUS_VLNV } from '../../../shared/busVlnv';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const library = builtinBusLibrary();

function legacyAvalon(root: 'busInterfaces' | 'bus_interfaces'): string {
  return `# Leading comment
apiVersion: '1.0'
vlnv:
  vendor: acme
  library: demo
  name: core
  version: 1.0.0
${root}:
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
    const result = migrateIpCoreYaml(legacyAvalon('busInterfaces'), library);

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
    const { text } = migrateIpCoreYaml(legacyAvalon('busInterfaces'), library);
    expect(text).toContain('# Leading comment');
    expect(text).toContain('# trailing comment');
    expect(text).toContain('0x20');
  });

  it('is idempotent', () => {
    const first = migrateIpCoreYaml(legacyAvalon('busInterfaces'), library);
    const second = migrateIpCoreYaml(first.text, library);
    expect(second).toEqual({
      text: first.text,
      changed: false,
      fromVersion: '1.1',
      toVersion: '1.1',
      mutationCount: 0,
    });
  });

  it('respects the bus_interfaces snake_case root', () => {
    const { text, changed } = migrateIpCoreYaml(legacyAvalon('bus_interfaces'), library);
    expect(changed).toBe(true);
    const data = yaml.parse(text) as Record<string, unknown>;
    expect(data.busInterfaces).toBeUndefined();
    const bus = (data.bus_interfaces as Array<Record<string, unknown>>)[0];
    expect(bus.useOptionalPorts).toContain('read');
    expect(bus.portPolarityOverrides).toMatchObject({ read: 'activeLow' });
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
    const source = legacyAvalon('busInterfaces').replace("apiVersion: '1.0'", "apiVersion: '1.1'");
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
