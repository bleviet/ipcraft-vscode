import {
  createRevisionState,
  shouldApplyUpdate,
  buildUpdateMessage,
  nextEditRevision,
} from '../../../webview/sync/revisionFilter';

describe('revisionFilter', () => {
  describe('buildUpdateMessage', () => {
    it('omits baseDocVersion until a real version has been seen (fix V-4 #4)', () => {
      const state = createRevisionState(); // seenDocVersion = -1
      const msg = buildUpdateMessage(state, 'a: 1');

      expect(msg).toEqual({ type: 'update', text: 'a: 1', editId: 1 });
      expect('baseDocVersion' in msg).toBe(false);
    });

    it('includes baseDocVersion once a version has been seen', () => {
      const state = createRevisionState();
      shouldApplyUpdate(state, { docVersion: 4 }); // seenDocVersion = 4

      const msg = buildUpdateMessage(state, 'a: 1');

      expect(msg).toEqual({ type: 'update', text: 'a: 1', editId: 1, baseDocVersion: 4 });
    });

    it('advances the monotonic editId on each send', () => {
      const state = createRevisionState();

      expect(buildUpdateMessage(state, 'x').editId).toBe(1);
      expect(buildUpdateMessage(state, 'y').editId).toBe(2);
      expect(state.lastSentEditId).toBe(2);
    });
  });

  describe('nextEditRevision', () => {
    it('shares edit IDs and the latest document base with non-text editors', () => {
      const state = createRevisionState();
      state.seenDocVersion = 7;

      expect(nextEditRevision(state)).toEqual({ editId: 1, baseDocVersion: 7 });
      expect(nextEditRevision(state)).toEqual({ editId: 2, baseDocVersion: 7 });
    });
  });

  describe('shouldApplyUpdate', () => {
    it('applies a fresh external update and advances seenDocVersion', () => {
      const state = createRevisionState();

      expect(shouldApplyUpdate(state, { docVersion: 2 })).toBe(true);
      expect(state.seenDocVersion).toBe(2);
    });

    it('drops a stale / out-of-order update (docVersion <= seen)', () => {
      const state = createRevisionState();
      shouldApplyUpdate(state, { docVersion: 5 });

      expect(shouldApplyUpdate(state, { docVersion: 5 })).toBe(false);
      expect(shouldApplyUpdate(state, { docVersion: 3 })).toBe(false);
      expect(state.seenDocVersion).toBe(5);
    });

    it('drops the echo of our own latest edit', () => {
      const state = createRevisionState();
      buildUpdateMessage(state, 'x'); // lastSentEditId = 1

      expect(shouldApplyUpdate(state, { docVersion: 2, sourceEditId: 1 })).toBe(false);
    });

    it('applies an update with no docVersion (legacy / unversioned host)', () => {
      const state = createRevisionState();

      expect(shouldApplyUpdate(state, {})).toBe(true);
    });

    it('forceResync applies even when the update is stale, and still advances seenDocVersion', () => {
      const state = createRevisionState();
      shouldApplyUpdate(state, { docVersion: 7 }); // seen = 7

      // docVersion 7 <= seen 7 would normally drop; forceResync overrides.
      expect(shouldApplyUpdate(state, { docVersion: 7, forceResync: true })).toBe(true);
      expect(state.seenDocVersion).toBe(7);
    });

    it('forceResync applies even when it looks like our own echo', () => {
      const state = createRevisionState();
      buildUpdateMessage(state, 'x'); // lastSentEditId = 1

      expect(shouldApplyUpdate(state, { docVersion: 2, sourceEditId: 1, forceResync: true })).toBe(
        true
      );
    });
  });
});
