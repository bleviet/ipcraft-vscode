import type { InterfaceDrift, StagingAction } from '../../shared/staging';
import { diffHdlInterface, hdlLanguageOf, syncInterfaceRegion } from './hdlInterface';
import { mergeThreeWay } from './threeWayMerge';

export interface ClassifyInput {
  relativePath: string;
  isProtected: boolean;
  /** On-disk content. */
  current: string;
  /** Newly generated content. */
  incoming: string;
  /** Last content IPCraft generated for this path, when known. */
  baseline: string | undefined;
}

export interface Classification {
  handEdited: boolean;
  autoMergeContent?: string;
  syncedContent?: string;
  interfaceDrift?: InterfaceDrift;
  actions: StagingAction[];
  defaultAction: StagingAction;
}

/** Computes the merge/sync offers and the default action for a modified file. */
export function classifyModifiedFile(input: ClassifyInput): Classification {
  const { relativePath, isProtected, current, incoming, baseline } = input;
  const handEdited = baseline !== undefined && current !== baseline;

  let autoMergeContent: string | undefined;
  if (handEdited) {
    const merged = mergeThreeWay(baseline, current, incoming);
    if (merged.clean && merged.content !== current) {
      autoMergeContent = merged.content;
    }
  }

  let interfaceDrift: InterfaceDrift | undefined;
  let syncedContent: string | undefined;
  const lang = hdlLanguageOf(relativePath);
  if (lang) {
    interfaceDrift = diffHdlInterface(current, incoming, lang);
    if (interfaceDrift) {
      const synced = syncInterfaceRegion(current, incoming, lang);
      if (synced !== undefined && synced !== current) {
        syncedContent = synced;
      }
    }
  }

  const actions: StagingAction[] = ['keep', 'overwrite'];
  if (autoMergeContent !== undefined) {
    actions.push('auto-merge');
  }
  if (syncedContent !== undefined) {
    actions.push('sync-interface');
  }

  let defaultAction: StagingAction;
  if (isProtected) {
    defaultAction = 'keep';
  } else if (!handEdited) {
    defaultAction = 'overwrite';
  } else if (baseline === incoming) {
    defaultAction = 'keep';
  } else {
    defaultAction = autoMergeContent !== undefined ? 'auto-merge' : 'keep';
  }

  return { handEdited, autoMergeContent, syncedContent, interfaceDrift, actions, defaultAction };
}
