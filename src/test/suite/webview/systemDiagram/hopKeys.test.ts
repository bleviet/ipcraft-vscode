import { hopStepOfKey } from '../../../../webview/systemDiagram/hopKeys';

const none = { ctrlKey: false, metaKey: false, altKey: false };

describe('hopStepOfKey', () => {
  it('maps + and = to a step up and - to a step down', () => {
    expect(hopStepOfKey('+', none)).toBe(1);
    expect(hopStepOfKey('=', none)).toBe(1);
    expect(hopStepOfKey('-', none)).toBe(-1);
  });

  it('ignores other keys and any Ctrl, Meta or Alt chord', () => {
    expect(hopStepOfKey('a', none)).toBeUndefined();
    expect(hopStepOfKey('+', { ...none, ctrlKey: true })).toBeUndefined();
    expect(hopStepOfKey('-', { ...none, metaKey: true })).toBeUndefined();
    expect(hopStepOfKey('=', { ...none, altKey: true })).toBeUndefined();
  });
});
