import React, { useState, useRef, useCallback, useMemo, type DragEvent } from 'react';
import { BUS_VLNV } from '../../../../shared/busVlnv';
import { DRAG_MIME, setActiveDragPayload, type LibraryDragPayload } from './canvasDragTypes';

export { DRAG_MIME, getActiveDragPayload, type LibraryDragPayload } from './canvasDragTypes';

interface PaletteCategory {
  title: string;
  items: LibraryDragPayload[];
}

const PALETTE: PaletteCategory[] = [
  {
    title: 'Generics',
    items: [
      { kind: 'parameter', dataType: 'integer', nameHint: 'DATA_WIDTH', label: 'Integer Generic' },
      { kind: 'parameter', dataType: 'boolean', nameHint: 'ENABLE', label: 'Boolean Generic' },
      { kind: 'parameter', dataType: 'string', nameHint: 'INIT_FILE', label: 'String Generic' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { kind: 'clock', nameHint: 'clk', label: 'Clock' },
      { kind: 'reset', nameHint: 'rst_n', label: 'Reset' },
      { kind: 'interrupt', nameHint: 'irq', label: 'Interrupt' },
      { kind: 'port', nameHint: 'port_0', label: 'Port' },
    ],
  },
  {
    title: 'Bus Protocols',
    items: [
      {
        kind: 'bus',
        type: BUS_VLNV.AXI4_LITE,
        mode: 'slave',
        nameHint: 'axi_lite',
        label: 'AXI4-Lite',
        vendor: 'IPCraft',
      },
      {
        kind: 'bus',
        type: BUS_VLNV.AXI4_FULL,
        mode: 'slave',
        nameHint: 'axi_full',
        label: 'AXI4-Full',
        vendor: 'IPCraft',
      },
      {
        kind: 'bus',
        type: BUS_VLNV.AXI_STREAM,
        mode: 'slave',
        nameHint: 'axis',
        label: 'AXI-Stream',
        vendor: 'IPCraft',
      },
      {
        kind: 'bus',
        type: BUS_VLNV.AVALON_MM,
        mode: 'slave',
        nameHint: 'avl_mm',
        label: 'Avalon-MM',
        vendor: 'IPCraft',
      },
      {
        kind: 'bus',
        type: BUS_VLNV.AVALON_ST,
        mode: 'slave',
        nameHint: 'avl_st',
        label: 'Avalon-ST',
        vendor: 'IPCraft',
      },
      {
        kind: 'bus',
        type: BUS_VLNV.CONDUIT,
        mode: 'conduit',
        nameHint: 'custom_if',
        label: 'Custom Interface',
        vendor: 'IPCraft',
      },
    ],
  },
];

/** Ordered-subsequence fuzzy match (the technique behind VS Code's own Quick
 *  Open): every character of `query` must appear in `text` in order, but not
 *  necessarily contiguously. Case-insensitive; an empty query matches everything. */
function fuzzyMatch(query: string, text: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
    }
  }
  return qi === q.length;
}

function itemSearchText(item: LibraryDragPayload): string {
  return [item.label, item.vendor, item.nameHint].filter(Boolean).join(' ');
}

const BUILT_IN_BUS_KEYS = new Set([
  'AXI4_LITE',
  'AXI4_FULL',
  'AXI_STREAM',
  'AVALON_MEMORY_MAPPED',
  'AVALON_STREAMING',
]);

function buildUserBusItems(busLibrary: Record<string, unknown>): LibraryDragPayload[] {
  const items: LibraryDragPayload[] = [];

  for (const [key, value] of Object.entries(busLibrary)) {
    if (BUILT_IN_BUS_KEYS.has(key)) {
      continue;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      continue;
    }

    const entry = value as Record<string, unknown>;
    const busType = entry.busType;
    if (!busType || typeof busType !== 'object' || Array.isArray(busType)) {
      continue;
    }

    const bt = busType as Record<string, unknown>;
    const vendor = typeof bt.vendor === 'string' ? bt.vendor : 'user';
    const library = typeof bt.library === 'string' ? bt.library : 'busif';
    const name = typeof bt.name === 'string' ? bt.name : key.toLowerCase();
    const version = typeof bt.version === 'string' ? bt.version : '1.0';
    const vlnv = `${vendor}:${library}:${name}:${version}`;

    // Build display label from busType.name, fall back to the key
    let label: string;
    if (typeof bt.name === 'string') {
      label = bt.name
        .replace(/_/g, '-')
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('-');
    } else {
      label = key;
    }

    const mode = 'slave';

    items.push({
      kind: 'bus',
      type: vlnv,
      mode,
      nameHint: name,
      label,
      vendor,
    });
  }

  return disambiguateLabels(dedupeByVlnv(items));
}

/**
 * Drops items whose VLNV (the `type` field, for kind=bus) has already been
 * seen, keeping the first occurrence. Discovery merges several sources
 * (Vivado catalog cache, workspace scan, busLibraryPaths) into one dict keyed
 * by a derived library key — two different keys can still describe the exact
 * same VLNV (e.g. the same XML found by two discovery paths), which would
 * otherwise render as a true duplicate row.
 */
function dedupeByVlnv(items: LibraryDragPayload[]): LibraryDragPayload[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (item.kind !== 'bus' || !item.type) {
      return true;
    }
    if (seen.has(item.type)) {
      return false;
    }
    seen.add(item.type);
    return true;
  });
}

/**
 * When two or more *distinct* bus items share a display label — e.g. a
 * Vivado interface library commonly carries several versions of the same
 * named interface, such as `xilinx.com:interface:jtag:1.0` and `:2.0` — append
 * the VLNV version to each colliding label so they read as the different
 * interfaces they are, instead of looking like duplicates.
 */
function disambiguateLabels(items: LibraryDragPayload[]): LibraryDragPayload[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = item.label.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return items.map((item) => {
    const version = item.type?.split(':').pop();
    if (!version || (counts.get(item.label.toLowerCase()) ?? 0) < 2) {
      return item;
    }
    return { ...item, label: `${item.label} (v${version})` };
  });
}

const LIBRARY_WIDTH_KEY = 'ipcraft.libraryPaletteWidth';
const LIBRARY_MIN_WIDTH = 180;
const LIBRARY_MAX_WIDTH = 480;
const LIBRARY_DEFAULT_WIDTH = 250;

interface LibraryPaletteProps {
  onCollapse?: () => void;
  busLibrary?: Record<string, unknown>;
}

/** Single draggable row: icon, label, and a vendor badge (bus items) or kind badge (ports/interrupts). */
const PaletteItem: React.FC<{
  item: LibraryDragPayload;
  onDragStart: (e: DragEvent, item: LibraryDragPayload) => void;
  onDragEnd: () => void;
}> = ({ item, onDragStart, onDragEnd }) => {
  const badge = kindBadge(item);
  return (
    <div
      className="library-palette__item"
      draggable
      onDragStart={(e) => onDragStart(e, item)}
      onDragEnd={onDragEnd}
    >
      <span className={`codicon ${paletteItemIcon(item)}`}></span>
      <span
        className="library-palette__item-label"
        title={item.kind === 'bus' && item.type ? `VLNV: ${item.type}` : undefined}
      >
        {item.label}
      </span>
      {item.vendor ? (
        <span className="library-palette__item-vendor" title={`Vendor: ${item.vendor}`}>
          {item.vendor}
        </span>
      ) : (
        badge && <span className="library-palette__item-kind">{badge}</span>
      )}
    </div>
  );
};

/**
 * Drag-and-drop primitive library for adding elements to the canvas.
 *
 * Items are grouped by category (protocols, infrastructure). Dragging an item
 * onto the canvas triggers element creation via the drop handler. A search box
 * fuzzy-filters every category (label, vendor, and name hint) so a large set
 * of discovered/custom interfaces stays easy to find.
 */
export const LibraryPalette: React.FC<LibraryPaletteProps> = ({ onCollapse, busLibrary }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const isSearching = query.trim().length > 0;

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const stored = sessionStorage.getItem(LIBRARY_WIDTH_KEY);
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= LIBRARY_MIN_WIDTH && w <= LIBRARY_MAX_WIDTH) {
          return w;
        }
      }
    } catch {
      // sessionStorage may be unavailable in some webview contexts
    }
    return LIBRARY_DEFAULT_WIDTH;
  });
  const panelWidthRef = useRef(panelWidth);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      // dragging right (larger clientX) widens the left-anchored panel
      const delta = ev.clientX - startX;
      const newWidth = Math.max(LIBRARY_MIN_WIDTH, Math.min(LIBRARY_MAX_WIDTH, startWidth + delta));
      panelWidthRef.current = newWidth;
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        sessionStorage.setItem(LIBRARY_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        // ignore
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const toggleCategory = useCallback((title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  }, []);

  const handleDragStart = useCallback((e: DragEvent, item: LibraryDragPayload) => {
    setActiveDragPayload(item);
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleDragEnd = useCallback(() => {
    setActiveDragPayload(null);
  }, []);

  const userItems = useMemo(() => (busLibrary ? buildUserBusItems(busLibrary) : []), [busLibrary]);

  const allCategories = useMemo<PaletteCategory[]>(
    () =>
      userItems.length > 0 ? [...PALETTE, { title: 'User Interfaces', items: userItems }] : PALETTE,
    [userItems]
  );

  const visibleCategories = useMemo<PaletteCategory[]>(() => {
    if (!isSearching) {
      return allCategories;
    }
    return allCategories
      .map((category) => ({
        ...category,
        items: category.items.filter((item) => fuzzyMatch(query, itemSearchText(item))),
      }))
      .filter((category) => category.items.length > 0);
  }, [allCategories, isSearching, query]);

  const hasResults = visibleCategories.some((category) => category.items.length > 0);

  return (
    <div className="library-palette" style={{ width: panelWidth }}>
      {/* Resize handle on the right edge */}
      <div className="library-palette__resize-handle" onMouseDown={handleResizeMouseDown} />

      {/* Header — always visible */}
      <div className="library-palette__header">
        <span className="library-palette__title">Library</span>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="library-palette__close"
            title="Close library"
            aria-label="Close library"
            type="button"
          >
            <span className="codicon codicon-chevron-left"></span>
          </button>
        )}
      </div>

      {/* Search — always visible */}
      <div className="library-palette__search">
        <span className="codicon codicon-search library-palette__search-icon"></span>
        <input
          type="text"
          className="library-palette__search-input"
          placeholder="Search interfaces..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search library interfaces"
        />
        {isSearching && (
          <button
            type="button"
            className="library-palette__search-clear"
            onClick={() => setQuery('')}
            title="Clear search"
            aria-label="Clear search"
          >
            <span className="codicon codicon-close"></span>
          </button>
        )}
      </div>

      {/* Scrollable content area */}
      <div className="library-palette__content">
        {/* Hint */}
        {!isSearching && (
          <div className="library-palette__hint">Drag items onto the canvas to add them</div>
        )}

        {isSearching && !hasResults ? (
          <div className="library-palette__empty">
            No interfaces match &ldquo;{query.trim()}&rdquo;
          </div>
        ) : (
          visibleCategories.map((category) => {
            // While searching, a matching category is always shown expanded —
            // manual collapse state still applies once the search is cleared.
            const isCollapsed = !isSearching && Boolean(collapsed[category.title]);
            return (
              <div key={category.title} className="library-palette__category">
                <button
                  className="library-palette__category-header"
                  onClick={() => toggleCategory(category.title)}
                  type="button"
                >
                  <span
                    className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`}
                  ></span>
                  <span>{category.title}</span>
                </button>

                {!isCollapsed && (
                  <div className="library-palette__items">
                    {category.items.map((item) => (
                      <PaletteItem
                        // `type` (VLNV) uniquely identifies bus items post-dedup; nameHint
                        // alone collides for same-named items that differ only by version
                        // (e.g. two Vivado-cached versions of "jtag").
                        key={item.type ?? `${item.kind}-${item.nameHint}`}
                        item={item}
                        onDragStart={handleDragStart}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

function paletteItemIcon(item: LibraryDragPayload): string {
  switch (item.kind) {
    case 'bus':
      return 'codicon-plug';
    case 'clock':
      return 'codicon-watch';
    case 'reset':
      return 'codicon-debug-restart';
    case 'parameter':
      return 'codicon-symbol-constant';
    case 'interrupt':
      return 'codicon-zap';
    case 'port':
      if (item.direction === 'in') {
        return 'codicon-arrow-right';
      }
      if (item.direction === 'out') {
        return 'codicon-arrow-left';
      }
      return 'codicon-arrow-both';
  }
}

function kindBadge(item: LibraryDragPayload): string {
  if (item.kind === 'interrupt') {
    if (!item.direction) {
      return '';
    }
    return item.direction === 'in' ? 'irq-in' : 'irq-out';
  }
  if (item.kind === 'port' && item.direction) {
    return item.direction === 'in' ? 'in' : item.direction === 'out' ? 'out' : 'io';
  }
  return '';
}
