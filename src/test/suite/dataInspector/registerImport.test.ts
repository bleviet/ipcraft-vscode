import * as vscode from 'vscode';
import {
  copyRegisterLayout,
  DataInspectorRegisterLayoutReader,
} from '../../../services/DataInspectorRegisterLayoutReader';

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
      registerName: 'STATUS',
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
    jest.mocked(vscode.workspace.findFiles).mockResolvedValue([invalidUri, validUri]);
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

    const layouts = await new DataInspectorRegisterLayoutReader().load();

    expect(layouts).toHaveLength(1);
    expect(layouts[0].registerName).toBe('STATUS');
    expect(vscode.workspace.findFiles).toHaveBeenCalledWith(
      '**/*.mm.yml',
      '**/{node_modules,dist}/**',
      1000
    );
  });
});
