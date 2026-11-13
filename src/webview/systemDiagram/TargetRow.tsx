import React from 'react';
import type { ResolvedTarget } from './changeTargets';
import { isTargetSelected } from './changeTargets';
import type { Selection } from './model';

interface TargetRowProps {
  /** What the row selects; the row is dimmed and does nothing when it is undefined. */
  target: ResolvedTarget | undefined;
  selection: Selection | null;
  onSelectInstance: (instancePath: string) => void;
  /** Selects an external port of the root level. */
  onSelectPort: (name: string) => void;
  title?: string;
  children: React.ReactNode;
}

/** A table row that selects its block or external port on click or Enter; the one row of the Changes and Findings tabs. */
export function TargetRow({
  target,
  selection,
  onSelectInstance,
  onSelectPort,
  title,
  children,
}: TargetRowProps) {
  const open = (found: ResolvedTarget) => {
    if (found.kind === 'instance') {
      onSelectInstance(found.path);
    } else {
      onSelectPort(found.name);
    }
  };
  return (
    <tr
      className={`${target ? 'sd-clickable cursor-pointer' : 'opacity-70'}${
        isTargetSelected(target, selection) ? ' sd-row-selected' : ''
      }`}
      title={title}
      tabIndex={target ? 0 : undefined}
      onClick={target ? () => open(target) : undefined}
      onKeyDown={
        target
          ? (event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                open(target);
              }
            }
          : undefined
      }
    >
      {children}
    </tr>
  );
}
