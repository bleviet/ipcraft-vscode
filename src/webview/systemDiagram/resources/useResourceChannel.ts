import { useMemo } from 'react';
import type {
  DiagramResources,
  SystemDiagramToExtensionMessage,
} from '../../../shared/messages/systemDiagram';

/** The resource sources and numbers the extension sent, and the gestures that ask it for others. */
export interface ResourceChannel {
  resources: DiagramResources | undefined;
  /** Counts the messages that ask the view to turn Resources on (the Attach Resource Report command). */
  showToken: number;
  /** Resources was turned on for the first time: find the reports. */
  load: () => void;
  select: (id: string) => void;
  /** Pick report files to attach. */
  attach: () => void;
  /** Pick a folder to look for reports in. */
  chooseFolder: () => void;
  remove: (id: string) => void;
  /** Which report path is the design, when several rows could be. */
  chooseRoot: (root: string) => void;
  /** Open the checkpoint of a source in Vivado and write its report. */
  extract: (id: string) => void;
  /** Show another source next to the chosen one; undefined clears it. */
  compare: (id: string | undefined) => void;
}

export function useResourceChannel(
  resources: DiagramResources | undefined,
  showToken: number,
  post: (message: SystemDiagramToExtensionMessage) => void
): ResourceChannel {
  return useMemo(
    () => ({
      resources,
      showToken,
      load: () => post({ type: 'loadResources' }),
      select: (id) => post({ type: 'selectResourceSource', id }),
      attach: () => post({ type: 'attachResourceReport' }),
      chooseFolder: () => post({ type: 'chooseResourceFolder' }),
      remove: (id) => post({ type: 'removeResourceSource', id }),
      chooseRoot: (root) => post({ type: 'chooseResourceRoot', root }),
      extract: (id) => post({ type: 'extractResources', id }),
      compare: (id) => post({ type: 'compareResourceSource', ...(id !== undefined && { id }) }),
    }),
    [resources, showToken, post]
  );
}
