import { crossCheckIpCoreAgainstVendor } from '../../../../generator/validation/hdlCrossCheck';
import { diffMemoryMaps } from '../../../../generator/validation/registerCrossCheck';
import { normalizeMemoryMap } from '../../../../domain/parse';
import type { IpCoreData } from '../../../../generator/types';

function baseIpCore(overrides: Partial<IpCoreData> = {}): IpCoreData {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'led_blink', version: '1.0.0' },
    memoryMaps: { import: 'core.mm.yml' },
    ...overrides,
  } as IpCoreData;
}

const SSOT_MM_YAML = [
  '- name: REGS',
  '  description: Register map',
  '  addressBlocks:',
  '    - name: CTRL',
  '      baseAddress: 0',
  '      usage: register',
  '      access: read-write',
  '      defaultRegWidth: 32',
  '      registers:',
  '        - name: STATUS',
  '          offset: 0',
  '          access: read-only',
  '          description: Status register',
  '          fields:',
  '            - name: READY',
  '              bits: "[0:0]"',
  '              access: read-only',
  '        - name: CONTROL',
  '          offset: 4',
  '          access: read-write',
  '          description: Control register',
  '          fields:',
  '            - name: ENABLE',
  '              bits: "[0:0]"',
  '              access: read-write',
].join('\n');

function componentXmlWith(registersXml: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">',
    '  <spirit:vendor>acme.com</spirit:vendor>',
    '  <spirit:library>ip</spirit:library>',
    '  <spirit:name>led_blink</spirit:name>',
    '  <spirit:version>1.0</spirit:version>',
    '  <spirit:memoryMaps>',
    '    <spirit:memoryMap>',
    '      <spirit:name>REGS</spirit:name>',
    '      <spirit:addressBlock>',
    '        <spirit:name>CTRL</spirit:name>',
    '        <spirit:baseAddress>0</spirit:baseAddress>',
    '        <spirit:range>256</spirit:range>',
    '        <spirit:width>32</spirit:width>',
    registersXml,
    '      </spirit:addressBlock>',
    '    </spirit:memoryMap>',
    '  </spirit:memoryMaps>',
    '</spirit:component>',
  ].join('\n');
}

const CONSISTENT_REGISTERS_XML = [
  '        <spirit:register>',
  '          <spirit:name>STATUS</spirit:name>',
  '          <spirit:addressOffset>0</spirit:addressOffset>',
  '          <spirit:size>32</spirit:size>',
  '          <spirit:access>read-only</spirit:access>',
  '          <spirit:field>',
  '            <spirit:name>READY</spirit:name>',
  '            <spirit:bitOffset>0</spirit:bitOffset>',
  '            <spirit:bitWidth>1</spirit:bitWidth>',
  '            <spirit:access>read-only</spirit:access>',
  '          </spirit:field>',
  '        </spirit:register>',
  '        <spirit:register>',
  '          <spirit:name>CONTROL</spirit:name>',
  '          <spirit:addressOffset>4</spirit:addressOffset>',
  '          <spirit:size>32</spirit:size>',
  '          <spirit:access>read-write</spirit:access>',
  '          <spirit:field>',
  '            <spirit:name>ENABLE</spirit:name>',
  '            <spirit:bitOffset>0</spirit:bitOffset>',
  '            <spirit:bitWidth>1</spirit:bitWidth>',
  '            <spirit:access>read-write</spirit:access>',
  '          </spirit:field>',
  '        </spirit:register>',
].join('\n');

function makeVendorReader(componentXml: string): (absPath: string) => Promise<string> {
  return async (absPath: string) => {
    if (absPath.includes('component.xml')) {
      return componentXml;
    }
    if (absPath.endsWith('core.mm.yml')) {
      return SSOT_MM_YAML;
    }
    throw new Error(`ENOENT: ${absPath}`);
  };
}

describe('crossCheckIpCoreAgainstVendor — memory-map/register diffing against component.xml (issue #96)', () => {
  it('reports no findings for a fully-consistent register map', async () => {
    const ipCore = baseIpCore();
    const reader = makeVendorReader(componentXmlWith(CONSISTENT_REGISTERS_XML));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(findings).toEqual([]);
  });

  it('reports register-address-mismatch when a register offset drifts', async () => {
    const shiftedRegistersXml = CONSISTENT_REGISTERS_XML.replace(
      '<spirit:addressOffset>4</spirit:addressOffset>',
      '<spirit:addressOffset>8</spirit:addressOffset>'
    );
    const ipCore = baseIpCore();
    const reader = makeVendorReader(componentXmlWith(shiftedRegistersXml));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('register-address-mismatch');
    expect(findings[0].severity).toBe('amber');
    expect(findings[0].message).toContain('CONTROL');
    expect(findings[0].message).toContain('0x4');
    expect(findings[0].message).toContain('0x8');
  });

  it('reports missing-field when a declared field has no matching field in component.xml', async () => {
    const droppedFieldXml = CONSISTENT_REGISTERS_XML.replace(
      [
        '          <spirit:field>',
        '            <spirit:name>ENABLE</spirit:name>',
        '            <spirit:bitOffset>0</spirit:bitOffset>',
        '            <spirit:bitWidth>1</spirit:bitWidth>',
        '            <spirit:access>read-write</spirit:access>',
        '          </spirit:field>',
        '',
      ].join('\n'),
      ''
    );
    const ipCore = baseIpCore();
    const reader = makeVendorReader(componentXmlWith(droppedFieldXml));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('missing-field');
    expect(findings[0].severity).toBe('red');
    expect(findings[0].message).toContain('ENABLE');
  });

  it('reports field-range-mismatch when a field bit range widens', async () => {
    const widenedFieldXml = CONSISTENT_REGISTERS_XML.replace(
      [
        '          <spirit:field>',
        '            <spirit:name>READY</spirit:name>',
        '            <spirit:bitOffset>0</spirit:bitOffset>',
        '            <spirit:bitWidth>1</spirit:bitWidth>',
        '            <spirit:access>read-only</spirit:access>',
        '          </spirit:field>',
      ].join('\n'),
      [
        '          <spirit:field>',
        '            <spirit:name>READY</spirit:name>',
        '            <spirit:bitOffset>0</spirit:bitOffset>',
        '            <spirit:bitWidth>4</spirit:bitWidth>',
        '            <spirit:access>read-only</spirit:access>',
        '          </spirit:field>',
      ].join('\n')
    );
    const ipCore = baseIpCore();
    const reader = makeVendorReader(componentXmlWith(widenedFieldXml));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('field-range-mismatch');
    expect(findings[0].severity).toBe('amber');
    expect(findings[0].message).toContain('READY');
  });

  it('reports no findings when the .ip.yml declares no memoryMaps', async () => {
    const ipCore = baseIpCore({ memoryMaps: undefined });
    const reader = makeVendorReader(componentXmlWith(CONSISTENT_REGISTERS_XML));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(findings).toEqual([]);
  });
});

describe('diffMemoryMaps — pure comparator', () => {
  it('reports missing-register and extra-register for registers unique to one side', () => {
    const ssot = normalizeMemoryMap({
      name: 'REGS',
      addressBlocks: [
        {
          name: 'CTRL',
          baseAddress: 0,
          defaultRegWidth: 32,
          registers: [{ name: 'ONLY_IN_SSOT', offset: 0, access: 'read-only', fields: [] }],
        },
      ],
    });
    const vendor = normalizeMemoryMap({
      name: 'REGS',
      addressBlocks: [
        {
          name: 'CTRL',
          baseAddress: 0,
          defaultRegWidth: 32,
          registers: [{ name: 'ONLY_IN_VENDOR', offset: 0, access: 'read-only', fields: [] }],
        },
      ],
    });

    const findings = diffMemoryMaps([ssot], [vendor], 'xilinx/component.xml', 'componentXml');

    expect(findings.find((f) => f.kind === 'missing-register')?.message).toContain('ONLY_IN_SSOT');
    expect(findings.find((f) => f.kind === 'extra-register')?.message).toContain('ONLY_IN_VENDOR');
    expect(findings.every((f) => f.source === 'componentXml')).toBe(true);
  });
});
