import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResourceReport } from '../../../domain/resourceUsage';
import type { ResourceChannel } from './useResourceChannel';
import { toolbarChip } from './resourceView';

/**
 * The Resources toggle: off by default, and the first time it turns on the reports are asked for
 * (once). A `show` message from the extension (the Attach Resource Report command) turns it on
 * without asking: the extension has loaded the reports. `report` is the chosen source mapped onto
 * the design while the toggle is on; it only decorates the diagram, so no toggle moves a block.
 */
export function useResourceView(channel: ResourceChannel | undefined): {
  on: boolean;
  setOn: (on: boolean) => void;
  report: ResourceReport | undefined;
  /** The second source the user compares with, mapped onto the design, while the toggle is on. */
  compare: ResourceReport | undefined;
  chip: string;
} {
  const [on, setOnState] = useState(false);
  const asked = useRef(false);
  const load = channel?.load;
  const setOn = useCallback(
    (next: boolean) => {
      setOnState(next);
      if (next && load && !asked.current) {
        asked.current = true;
        load();
      }
    },
    [load]
  );
  const showToken = channel?.showToken ?? 0;
  useEffect(() => {
    if (showToken > 0) {
      asked.current = true;
      setOnState(true);
    }
  }, [showToken]);
  const resources = channel?.resources;
  const chip = useMemo(() => toolbarChip(resources), [resources]);
  return {
    on,
    setOn,
    report: on ? resources?.report : undefined,
    compare: on ? resources?.compare?.report : undefined,
    chip,
  };
}
