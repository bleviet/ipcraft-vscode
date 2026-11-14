import type { CompareControlProps } from './CompareControl';
import type { useCompareView } from './hooks/useCompareView';

/** The props of the toolbar's compare control for the view of a comparison and the gestures that start, end and open it. */
export function compareControlProps(
  view: ReturnType<typeof useCompareView>,
  actions: Pick<CompareControlProps, 'onStart' | 'onStop' | 'onOpenChanges'>
): CompareControlProps {
  return {
    ...actions,
    compare: view.shown,
    marksOn: view.marksOn,
    onMarksChange: view.setMarksOn,
    onChangesOnly: view.changesOnly,
    showVersion: !view.hidingVersionOnly,
    removed: view.hasRemoved ? { on: view.removedOn, onChange: view.setRemovedOn } : undefined,
    versionOnly: view.hasVersionOnly
      ? { on: view.versionOnly, onChange: view.setVersionOnly }
      : undefined,
  };
}
