import {
  buildAddSubcoreMessage,
  buildCheckFilesExistMessage,
  buildOpenFileMessage,
  buildSaveCustomBusDefinitionMessage,
  buildSelectFilesMessage,
  listenForInspectorHostMessage,
} from '../../../webview/ipcore/components/canvas/inspector/inspectorMessages';
import {
  deleteGroup,
  renamePage,
} from '../../../webview/ipcore/components/canvas/inspector/parameters/PlacementControls';

describe('CanvasInspector typed message and edit builders', () => {
  it('builds each inspector request with the existing wire payload', () => {
    expect(buildCheckFilesExistMessage(['rtl/top.vhd'])).toEqual({
      type: 'checkFilesExist',
      paths: ['rtl/top.vhd'],
    });
    expect(buildOpenFileMessage('rtl/top.vhd')).toEqual({
      type: 'openFile',
      path: 'rtl/top.vhd',
    });
    expect(
      buildSelectFilesMessage({
        multi: false,
        startPath: 'maps/core.mm.yml',
        filters: { 'Memory Map': ['mm.yml', 'yml'] },
      })
    ).toEqual({
      type: 'selectFiles',
      multi: false,
      startPath: 'maps/core.mm.yml',
      filters: { 'Memory Map': ['mm.yml', 'yml'] },
    });
    expect(buildAddSubcoreMessage()).toEqual({ type: 'addSubcore' });
  });

  it('resolves parameter widths in the custom bus-definition payload', () => {
    expect(
      buildSaveCustomBusDefinitionMessage(
        'stream',
        [
          { name: 'data', direction: 'out', width: 'DATA_WIDTH' },
          { name: 'valid', direction: 'out', width: 1, presence: 'optional' },
          { name: 'fallback', direction: 'in', width: 'UNKNOWN' },
        ],
        [{ name: 'DATA_WIDTH', defaultValue: 32 }]
      )
    ).toEqual({
      type: 'saveCustomBusDefinition',
      typeName: 'stream',
      displayName: 'Stream',
      ports: [
        {
          name: 'data',
          direction: 'out',
          defaultWidth: 32,
          width: 'DATA_WIDTH',
          presence: 'required',
        },
        {
          name: 'valid',
          direction: 'out',
          defaultWidth: 1,
          width: 1,
          presence: 'optional',
        },
        {
          name: 'fallback',
          direction: 'in',
          defaultWidth: 1,
          width: 'UNKNOWN',
          presence: 'required',
        },
      ],
    });
  });

  it('delivers a matching host response once and removes its listener', () => {
    const onMessage = jest.fn();
    listenForInspectorHostMessage('filesSelected', onMessage);

    const response = { type: 'filesSelected', files: ['rtl/top.vhd'] };
    window.dispatchEvent(new MessageEvent('message', { data: response }));
    window.dispatchEvent(new MessageEvent('message', { data: response }));

    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(response);
  });

  it('builds ordered page and group mutations through the atomic update boundary', () => {
    const parameters = [
      { name: 'A', uiPage: 'General', uiGroup: 'Widths' },
      { name: 'B', uiPage: 'General', uiGroup: 'Widths' },
      { name: 'C', uiPage: 'Other', uiGroup: 'Widths' },
    ];
    const batchUpdate = jest.fn();
    const onUpdate = jest.fn();

    renamePage(parameters, 'General', 'Configuration', onUpdate, batchUpdate);
    expect(batchUpdate).toHaveBeenCalledWith([
      [['parameters', 0, 'uiPage'], 'Configuration'],
      [['parameters', 1, 'uiPage'], 'Configuration'],
    ]);

    deleteGroup(parameters, 'General', 'Widths', onUpdate, batchUpdate);
    expect(batchUpdate).toHaveBeenLastCalledWith([
      [['parameters', 0, 'uiGroup'], null],
      [['parameters', 1, 'uiGroup'], null],
    ]);
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
