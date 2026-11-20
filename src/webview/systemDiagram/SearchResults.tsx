import React, { useEffect, useMemo, useRef, useState } from 'react';
import { initiallyCollapsed, type MatchGroup, type ResultRow } from './search';

export interface SearchResultsProps {
  groups: readonly MatchGroup[];
  summary: string;
  /** The match the canvas is on: its row is marked. */
  currentId?: string;
  rowOf: (path: string) => ResultRow;
  /** Prefix of the element ids; the search input points at the current option through it. */
  listId: string;
  onPick: (path: string) => void;
}

/** Id of the option at `index` of the flattened results (the input's aria-activedescendant). */
export function resultOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** Keeps a click in the list from taking the focus off the search input. */
const keepFocus = (event: React.MouseEvent) => event.preventDefault();

/** The dropdown under the search box: the matches grouped by level, long lists collapsed. */
export function SearchResults({
  groups,
  summary,
  currentId,
  rowOf,
  listId,
  onPick,
}: SearchResultsProps) {
  // The toggles belong to the groups they were made on: other groups start from the default again.
  const [toggles, setToggles] = useState<{
    groups: readonly MatchGroup[];
    collapsed: ReadonlyMap<string, boolean>;
  }>({ groups, collapsed: new Map() });
  const toggled = toggles.groups === groups ? toggles.collapsed : undefined;
  const currentRef = useRef<HTMLDivElement>(null);
  const collapsedByDefault = useMemo(
    () => initiallyCollapsed(groups, currentId),
    [groups, currentId]
  );
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [currentId, groups]);

  // Option ids count the matches of collapsed groups too, so an id is the match's index in the list.
  let groupStart = 0;
  return (
    <div className="sd-search-results absolute left-0 top-full z-50 mt-1 w-[320px] max-w-[calc(100vw-16px)] text-xs">
      <div className="sd-search-summary px-2 py-1 opacity-70">{summary}</div>
      <div
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="max-h-[260px] overflow-auto"
      >
        {groups.map((group, groupIndex) => {
          const start = groupStart;
          groupStart += group.paths.length;
          const headerId = `${listId}-group-${groupIndex}`;
          const holdsCurrent = currentId !== undefined && group.paths.includes(currentId);
          const collapsed =
            !holdsCurrent && (toggled?.get(group.level) ?? collapsedByDefault.has(group.level));
          return (
            <div key={group.level} role="presentation">
              {/* Not focusable: a Tab from the input must not blur it and close the list. */}
              <div
                id={headerId}
                aria-hidden="true"
                className="sd-search-group flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-left font-semibold"
                title={group.label}
                onMouseDown={keepFocus}
                onClick={() => {
                  if (holdsCurrent) {
                    return;
                  }
                  setToggles({
                    groups,
                    collapsed: new Map(toggled).set(group.level, !collapsed),
                  });
                }}
              >
                <span
                  aria-hidden="true"
                  className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`}
                />
                <span className="truncate">
                  {group.label} ({group.paths.length})
                </span>
              </div>
              {collapsed ? null : (
                <div role="group" aria-labelledby={headerId}>
                  {group.paths.map((path, pathIndex) => {
                    const row = rowOf(path);
                    const current = path === currentId;
                    return (
                      <div
                        key={path}
                        id={resultOptionId(listId, start + pathIndex)}
                        ref={current ? currentRef : undefined}
                        role="option"
                        aria-selected={current}
                        className="sd-search-row flex cursor-pointer items-baseline gap-2 px-6 py-0.5"
                        onMouseDown={keepFocus}
                        onClick={() => onPick(path)}
                      >
                        <span className="truncate">{row.name}</span>
                        {row.type && <span className="truncate opacity-60">{row.type}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
