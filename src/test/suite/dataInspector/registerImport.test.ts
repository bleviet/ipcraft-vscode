import * as vscode from 'vscode';
import type { ResourceRoots } from '../../../services/ResourceRoots';
import { loadRuntimeBusLibrary } from '../../../services/loadRuntimeBusLibrary';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import {
  copyRegisterLayout,
  DataInspectorRegisterLayoutReader,
} from '../../../services/DataInspectorRegisterLayoutReader';

jest.mock('../../../services/loadRuntimeBusLibrary', () => ({
  loadRuntimeBusLibrary: jest.fn(),
}));

const roots = {} as ResourceRoots;

describe('register layout import', () => {
  it('copies only width, field geometry, descriptions, enums, and provenance', () => {
    const source = {
      name: 'STATUS',
      size: 32,
      offset: 64,
      access: 'read-only',
      resetValue: 255,
      fields: [
        {
          name: 'STATE',
          offset: 4,
          width: 3,
          description: 'Current state',
          enumeratedValues: { '0': 'IDLE', '1': 'RUN' },
          access: 'read-only',
          resetValue: 1,
        },
      ],
    };
    const layout = copyRegisterLayout('maps/core.mm.yml', 'REGS', source);

    expect(layout).toMatchObject({
      width: 32,
      sourceFile: 'maps/core.mm.yml',
      kind: 'register',
      provenance: { sourceFile: 'maps/core.mm.yml', registerName: 'STATUS' },
      fields: [
        {
          name: 'STATE',
          msb: 6,
          lsb: 4,
          description: 'Current state',
          enumValues: { '0': 'IDLE', '1': 'RUN' },
        },
      ],
    });
    expect(layout).not.toHaveProperty('offset');
    expect(layout).not.toHaveProperty('access');
    expect(layout).not.toHaveProperty('resetValue');
    expect(layout.fields[0]).not.toHaveProperty('access');
    expect(layout.fields[0]).not.toHaveProperty('resetValue');
  });

  it('does not retain a live object link to imported enum definitions', () => {
    const enumeratedValues = { '0': 'IDLE' };
    const source = {
      name: 'STATUS',
      size: 8,
      fields: [{ name: 'STATE', offset: 0, width: 1, enumeratedValues }],
    };
    const layout = copyRegisterLayout('core.mm.yml', 'REGS', source);

    enumeratedValues['0'] = 'CHANGED';
    expect(layout.fields[0].enumValues?.['0']).toBe('IDLE');
  });

  it('sanitizes field names into schema-valid unique IDs', () => {
    const layout = copyRegisterLayout('core.mm.yml', 'REGS', {
      name: 'STATUS',
      size: 8,
      fields: [
        { name: 'IRQ pending', offset: 0, width: 1 },
        { name: 'IRQ pending', offset: 1, width: 1 },
      ],
    });

    expect(layout.fields.map((field) => field.id)).toEqual([
      'import-0-IRQ-pending',
      'import-1-IRQ-pending',
    ]);
    expect(layout.fields.every((field) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(field.id))).toBe(
      true
    );
  });

  it('continues scanning after one memory map fails to parse', async () => {
    const invalidUri = { toString: () => 'file:///invalid.mm.yml' } as vscode.Uri;
    const validUri = { toString: () => 'file:///valid.mm.yml' } as vscode.Uri;
    jest
      .mocked(vscode.workspace.findFiles)
      .mockImplementation(async (pattern) =>
        pattern === '**/*.mm.yml' ? [invalidUri, validUri] : []
      );
    jest.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) => {
      if (uri === invalidUri) {
        return new Uint8Array(Buffer.from('name: [invalid'));
      }
      return new Uint8Array(
        Buffer.from(`
name: VALID_MAP
addressBlocks:
  - name: REGS
    registers:
      - name: STATUS
        size: 8
        fields:
          - name: READY
            bits: "[0:0]"
`)
      );
    });
    jest
      .mocked(vscode.workspace.asRelativePath)
      .mockImplementation((uri) => (uri === invalidUri ? 'invalid.mm.yml' : 'valid.mm.yml'));

    const layouts = await new DataInspectorRegisterLayoutReader(roots).load();

    expect(layouts).toHaveLength(1);
    expect(layouts[0].kind).toBe('register');
    expect(layouts[0].provenance).toEqual({ sourceFile: 'valid.mm.yml', registerName: 'STATUS' });
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      '**/*.mm.yml',
      '**/{node_modules,dist}/**',
      1000
    );
  });

  it('also scans .ip.yml files and appends port layouts after register layouts', async () => {
    const mmUri = { toString: () => 'file:///a.mm.yml' } as vscode.Uri;
    const ipUri = { toString: () => 'file:///s.ip.yml' } as vscode.Uri;
    jest
      .mocked(vscode.workspace.findFiles)
      .mockImplementation(async (pattern) =>
        pattern === '**/*.mm.yml' ? [mmUri] : pattern === '**/*.ip.yml' ? [ipUri] : []
      );
    jest.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
      uri === mmUri
        ? new Uint8Array(
            Buffer.from(
              'name: M\naddressBlocks:\n  - name: REGS\n    registers:\n      - name: STATUS\n        size: 8\n        fields:\n          - name: READY\n            bits: "[0:0]"\n'
            )
          )
        : new Uint8Array(
            Buffer.from(
              `apiVersion: 1.2
vlnv: { vendor: v, library: l, name: s, version: '1.0' }
ports:
  - name: o_status
    direction: out
    width: 8
    fields:
      - { name: state, bits: "[3:0]" }
busInterfaces:
  - name: m_axis
    type: ipcraft:busif:axi_stream:1.0
    mode: master
    portFields:
      tdata:
        - { name: low, bits: "[7:0]" }
`
            )
          )
    );
    jest
      .mocked(vscode.workspace.asRelativePath)
      .mockImplementation((uri) => (uri === mmUri ? 'a.mm.yml' : 'cores/s.ip.yml'));
    jest.mocked(loadRuntimeBusLibrary).mockResolvedValue(builtinBusLibrary());

    const layouts = await new DataInspectorRegisterLayoutReader(roots).load();

    expect(layouts.map((layout) => layout.kind)).toEqual(['register', 'port', 'port']);
    expect(layouts[1].provenance).toEqual({ sourceFile: 'cores/s.ip.yml', portName: 'o_status' });
    expect(layouts[2].provenance).toEqual({
      sourceFile: 'cores/s.ip.yml',
      busInterface: 'm_axis',
      portName: 'TDATA',
    });
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      '**/*.ip.yml',
      '**/{node_modules,dist}/**',
      1000
    );
  });

  it('does not load a bus library for an IP core without portFields', async () => {
    const ipUri = { toString: () => 'file:///s.ip.yml' } as vscode.Uri;
    jest.mocked(loadRuntimeBusLibrary).mockClear();
    jest
      .mocked(vscode.workspace.findFiles)
      .mockImplementation(async (pattern) => (pattern === '**/*.ip.yml' ? [ipUri] : []));
    jest
      .mocked(vscode.workspace.fs.readFile)
      .mockResolvedValue(
        new Uint8Array(
          Buffer.from(
            'ports:\n  - name: o\n    direction: out\n    width: 4\n    fields:\n      - { name: a, bits: "[0]" }\nbusInterfaces:\n  - name: m\n    type: ipcraft:busif:axi_stream:1.0\n    mode: master\n'
          )
        )
      );
    jest.mocked(vscode.workspace.asRelativePath).mockReturnValue('s.ip.yml');

    const layouts = await new DataInspectorRegisterLayoutReader(roots).load();

    expect(layouts).toHaveLength(1);
    expect(loadRuntimeBusLibrary).not.toHaveBeenCalled();
  });

  it('keeps top-level ports importable when the bus library fails to load', async () => {
    const ipUri = { toString: () => 'file:///s.ip.yml' } as vscode.Uri;
    jest
      .mocked(vscode.workspace.findFiles)
      .mockImplementation(async (pattern) => (pattern === '**/*.ip.yml' ? [ipUri] : []));
    jest.mocked(vscode.workspace.fs.readFile).mockResolvedValue(
      new Uint8Array(
        Buffer.from(
          `ports:
  - name: o_status
    direction: out
    width: 8
    fields:
      - { name: state, bits: "[3:0]" }
busInterfaces:
  - name: m_axis
    type: ipcraft:busif:axi_stream:1.0
    mode: master
    portFields:
      TDATA:
        - { name: low, bits: "[7:0]" }
`
        )
      )
    );
    jest.mocked(vscode.workspace.asRelativePath).mockReturnValue('s.ip.yml');
    jest.mocked(loadRuntimeBusLibrary).mockRejectedValue(new Error('no library'));

    const layouts = await new DataInspectorRegisterLayoutReader(roots).load();

    expect(layouts.map((layout) => layout.id)).toEqual(['s.ip.yml:port:o_status']);
  });
});
