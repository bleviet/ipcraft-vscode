import {
  parseLibraryDragPayload,
  parsePortMoveDragPayload,
  parseRemoveDragPayload,
} from '../../../webview/ipcore/components/canvas/canvasDragTypes';

describe('canvas drag payload parsing', () => {
  describe('parseRemoveDragPayload', () => {
    it.each(['null', 'false', '42', '[]', '{}', '{"action":"remove","kind":"port"}'])(
      'rejects malformed payload %s',
      (raw) => {
        expect(parseRemoveDragPayload(raw)).toBeNull();
      }
    );

    it('returns a validated remove payload', () => {
      expect(parseRemoveDragPayload('{"action":"remove","kind":"port","id":"port:0"}')).toEqual({
        action: 'remove',
        kind: 'port',
        id: 'port:0',
      });
    });
  });

  describe('parsePortMoveDragPayload', () => {
    it.each(['null', '[]', '{}', '{"portIndex":-1}', '{"portIndex":1.5}'])(
      'rejects malformed payload %s',
      (raw) => {
        expect(parsePortMoveDragPayload(raw)).toBeNull();
      }
    );

    it('returns a validated port move payload', () => {
      expect(parsePortMoveDragPayload('{"portIndex":2}')).toEqual({ portIndex: 2 });
    });
  });

  describe('parseLibraryDragPayload', () => {
    it.each([
      'null',
      '[]',
      '{}',
      '{"kind":"unknown","nameHint":"port","label":"Port"}',
      '{"kind":"port","nameHint":1,"label":"Port"}',
      '{"kind":"port","nameHint":"port","label":"Port","direction":"sideways"}',
    ])('rejects malformed payload %s', (raw) => {
      expect(parseLibraryDragPayload(raw)).toBeNull();
    });

    it('returns a validated library payload', () => {
      expect(
        parseLibraryDragPayload('{"kind":"port","nameHint":"data","label":"Port","direction":"in"}')
      ).toEqual({ kind: 'port', nameHint: 'data', label: 'Port', direction: 'in' });
    });
  });
});
