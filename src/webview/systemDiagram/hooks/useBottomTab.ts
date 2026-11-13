import { useEffect, useRef, useState } from 'react';
import type { BottomTab } from '../BottomPanel';

const isComparisonTab = (tab: BottomTab): boolean => tab === 'changes' || tab === 'findings';

/**
 * The bottom panel's tab. The Changes and Findings tabs exist while a comparison is on
 * (`baseLabel` is set): starting one, or picking a base with another label, opens the panel on
 * Changes; a new diff of the same base (a document edit) leaves the tab alone, and so does
 * picking a base with the same label again: the messages carry nothing else that tells the two
 * apart. Ending the comparison while one of them is selected falls back to the Address map; the
 * Findings tab does not open by itself. `openTab` selects a tab and expands the panel when it
 * is hidden.
 */
export function useBottomTab(
  baseLabel: string | undefined,
  bottom: { collapsed: boolean; toggle: () => void }
): { tab: BottomTab; setTab: (tab: BottomTab) => void; openTab: (tab: BottomTab) => void } {
  const comparing = baseLabel !== undefined;
  const [selected, setTab] = useState<BottomTab>('address');
  const shownLabel = useRef<string | undefined>(undefined);
  // The tab is gone with the comparison, before the effect below has reset the state.
  const tab = isComparisonTab(selected) && !comparing ? 'address' : selected;

  const openTab = (next: BottomTab) => {
    setTab(next);
    if (bottom.collapsed) {
      bottom.toggle();
    }
  };
  useEffect(() => {
    if (comparing && baseLabel !== shownLabel.current) {
      openTab('changes');
    } else if (!comparing && isComparisonTab(selected)) {
      setTab('address');
    }
    shownLabel.current = baseLabel;
  }, [baseLabel]);
  return { tab, setTab, openTab };
}
