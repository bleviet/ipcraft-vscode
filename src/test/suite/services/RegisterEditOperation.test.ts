import {
  applyRegisterEdit,
  fieldResetsWriteUpdate,
  fieldsWriteUpdate,
  REGISTER_EDIT_OP,
} from '../../../webview/services/RegisterEditOperation';

const TEXT = `- name: M
  addressBlocks:
    - name: B
      baseAddress: 0
      registers:
        - name: VERSION # the version register
          offset: 0
          resetValue: $version
          description: kept
        - name: OTHER
          offset: 4
          resetValue: $version.minor
`;

const registerPath = [0, 'addressBlocks', 0, 'registers', 0];

describe('fieldsWriteUpdate', () => {
  const fields = [{ name: 'F', bits: '[7:0]' }];

  it('is a plain fields write when the register has no reference', () => {
    expect(fieldsWriteUpdate(fields, false)).toEqual([['fields'], fields]);
  });

  it('is one register-edit that also removes the register resetValue key otherwise', () => {
    expect(fieldsWriteUpdate(fields, true)).toEqual([
      ['__op', REGISTER_EDIT_OP],
      { edits: [{ path: ['fields'], value: fields }], removeKeys: [['resetValue']] },
    ]);
  });
});

describe('fieldResetsWriteUpdate', () => {
  it('turns field resets into edits next to the register resetValue removal', () => {
    expect(
      fieldResetsWriteUpdate([
        { fieldIndex: 1, value: 5 },
        { fieldIndex: 3, value: 0 },
      ])
    ).toEqual([
      ['__op', REGISTER_EDIT_OP],
      {
        edits: [
          { path: ['fields', 1, 'resetValue'], value: 5 },
          { path: ['fields', 3, 'resetValue'], value: 0 },
        ],
        removeKeys: [['resetValue']],
      },
    ]);
  });
});

describe('applyRegisterEdit', () => {
  it('writes the edits and removes the key, leaving the rest of the document alone', () => {
    const [, payload] = fieldsWriteUpdate([{ name: 'F', bits: '[7:0]', resetValue: 0 }], true);
    const out = applyRegisterEdit(TEXT, registerPath, payload as never);
    expect(out).toContain('# the version register');
    expect(out).toContain('description: kept');
    expect(out).toContain('resetValue: $version.minor');
    expect(out).not.toMatch(/resetValue: \$version\n/);
    expect(out).toContain('- name: F');
  });

  it('returns the text unchanged when nothing changes', () => {
    expect(applyRegisterEdit(TEXT, registerPath, { edits: [], removeKeys: [['nothing']] })).toBe(
      TEXT
    );
  });

  it('removes the key even without edits', () => {
    const out = applyRegisterEdit(TEXT, registerPath, { edits: [], removeKeys: [['resetValue']] });
    expect(out).not.toMatch(/resetValue: \$version\n/);
    expect(out).toContain('description: kept');
  });
});
