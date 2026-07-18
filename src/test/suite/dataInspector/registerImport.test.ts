import { copyRegisterLayout } from '../../../services/DataInspectorRegisterLayoutReader';

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
});
