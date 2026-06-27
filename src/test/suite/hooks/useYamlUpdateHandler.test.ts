import { act, renderHook } from '@testing-library/react';
import { useYamlUpdateHandler } from '../../../webview/hooks/useYamlUpdateHandler';
import type { Selection } from '../../../webview/hooks/useSelection';
import { YamlService } from '../../../webview/services/YamlService';

// Standalone memory map YAML (array form): one block with two registers, each
// with one bit-field. getMapRootInfo resolves selectionRootPath -> [0].
const YAML = `- name: MYMAP
  addressBlocks:
    - name: BLOCK
      baseAddress: 0
      registers:
        - name: REG0
          offset: 0
          fields:
            - name: A
              bits: '[0:0]'
              access: read-write
        - name: REG1
          offset: 4
          fields:
            - name: B
              bits: '[0:0]'
              access: read-write
`;

function regsOf(text: string) {
  const doc = YamlService.safeParse(text) as Array<{
    addressBlocks: Array<{
      registers: Array<{ fields: Array<Record<string, unknown>> }>;
    }>;
  }>;
  return doc[0].addressBlocks[0].registers;
}

describe('useYamlUpdateHandler -- __op __regIndex (master-detail block)', () => {
  function setup(selection: Selection) {
    const rawTextRef: { current: string } = { current: YAML };
    const selectionRef: { current: Selection | null } = { current: selection };
    const updateRawText = jest.fn((t: string) => {
      rawTextRef.current = t;
    });
    const sendUpdate = jest.fn();
    const { result } = renderHook(() =>
      useYamlUpdateHandler({ selectionRef, rawTextRef, updateRawText, sendUpdate })
    );
    return { result, sendUpdate, rawTextRef };
  }

  const blockSelection: Selection = {
    id: 'block-0',
    type: 'block',
    object: { name: 'BLOCK' },
    breadcrumbs: ['MYMAP', 'BLOCK'],
    path: ['addressBlocks', 0],
  };

  it('routes a field-add to the register named by __regIndex', () => {
    const { result, sendUpdate } = setup(blockSelection);

    act(() => {
      result.current(['__op', 'field-add'], { name: 'C', afterIndex: 0, __regIndex: 1 });
    });

    expect(sendUpdate).toHaveBeenCalledTimes(1);
    const regs = regsOf(sendUpdate.mock.calls[0][0] as string);
    // REG0 (not targeted) is untouched.
    expect(regs[0].fields).toHaveLength(1);
    expect(regs[0].fields[0].name).toBe('A');
    // REG1 (__regIndex target) received the new field at the end.
    expect(regs[1].fields).toHaveLength(2);
    expect(regs[1].fields[1].name).toBe('C');
  });

  it('strips __regIndex so it never leaks into the written field payload', () => {
    const { result, sendUpdate } = setup(blockSelection);

    act(() => {
      result.current(['__op', 'field-add'], { name: 'D', afterIndex: 0, __regIndex: 0 });
    });

    const regs = regsOf(sendUpdate.mock.calls[0][0] as string);
    const added = regs[0].fields[1];
    expect(added.name).toBe('D');
    expect(added).not.toHaveProperty('__regIndex');
  });

  it('still routes __op through selection.path for a register selection (backward-compat)', () => {
    const registerSelection: Selection = {
      id: 'block-0-reg-1',
      type: 'register',
      object: { name: 'REG1' },
      breadcrumbs: ['MYMAP', 'BLOCK', 'REG1'],
      path: ['addressBlocks', 0, 'registers', 1],
    };
    const { result, sendUpdate } = setup(registerSelection);

    act(() => {
      // No __regIndex: the legacy register/array path must still work.
      result.current(['__op', 'field-add'], { name: 'C', afterIndex: 0 });
    });

    expect(sendUpdate).toHaveBeenCalledTimes(1);
    const regs = regsOf(sendUpdate.mock.calls[0][0] as string);
    expect(regs[1].fields).toHaveLength(2);
    expect(regs[1].fields[1].name).toBe('C');
  });
});
