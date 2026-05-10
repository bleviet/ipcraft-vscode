import React, { useState, useCallback, type DragEvent } from 'react';

/** Payload attached to drag events from the library palette */
export interface LibraryDragPayload {
  kind: 'bus' | 'clock' | 'reset' | 'port' | 'parameter' | 'interrupt';
  /** Bus type VLNV (only for kind=bus) */
  type?: string;
  /** Bus mode: slave/master/sink/source (only for kind=bus) */
  mode?: string;
  /** Port/interrupt direction (only for kind=port or kind=interrupt) */
  direction?: 'in' | 'out' | 'inout';
  /** Generic data type (only for kind=parameter) */
  dataType?: string;
  /** Default name hint */
  nameHint: string;
  /** Display label in the palette */
  label: string;
}

const DRAG_MIME = 'application/x-ipcraft-palette';

interface PaletteCategory {
  title: string;
  items: LibraryDragPayload[];
}

const PALETTE: PaletteCategory[] = [
  {
    title: 'Generics',
    items: [
      { kind: 'parameter', dataType: 'integer', nameHint: 'DATA_WIDTH', label: 'Integer Generic' },
      { kind: 'parameter', dataType: 'natural', nameHint: 'DEPTH', label: 'Natural Generic' },
      { kind: 'parameter', dataType: 'boolean', nameHint: 'ENABLE', label: 'Boolean Generic' },
      { kind: 'parameter', dataType: 'string', nameHint: 'INIT_FILE', label: 'String Generic' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { kind: 'clock', nameHint: 'clk', label: 'Clock' },
      { kind: 'reset', nameHint: 'rst_n', label: 'Reset' },
      { kind: 'interrupt', direction: 'out', nameHint: 'irq', label: 'Interrupt Output' },
      { kind: 'interrupt', direction: 'in', nameHint: 'irq_in', label: 'Interrupt Input' },
      { kind: 'port', direction: 'in', nameHint: 'port_in', label: 'Input Port' },
      { kind: 'port', direction: 'out', nameHint: 'port_out', label: 'Output Port' },
      { kind: 'port', direction: 'inout', nameHint: 'port_io', label: 'Inout Port' },
    ],
  },
  {
    title: 'Bus Protocols',
    items: [
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi4_lite.1.0',
        mode: 'slave',
        nameHint: 'axi_lite',
        label: 'AXI4-Lite',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi4_full.1.0',
        mode: 'slave',
        nameHint: 'axi_full',
        label: 'AXI4-Full',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi_stream.1.0',
        mode: 'sink',
        nameHint: 'axis',
        label: 'AXI-Stream',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.avalon_mm.1.0',
        mode: 'slave',
        nameHint: 'avl_mm',
        label: 'Avalon-MM',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.avalon_st.1.0',
        mode: 'sink',
        nameHint: 'avl_st',
        label: 'Avalon-ST',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.conduit.1.0',
        mode: 'conduit',
        nameHint: 'custom_if',
        label: 'Custom Interface',
      },
    ],
  },
];

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
    const vlnv = `${vendor}.${library}.${name}.${version}`;

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

    // Determine default mode
    const nameLower = name.toLowerCase();
    const mode = nameLower.includes('stream') || nameLower.includes('_st') ? 'sink' : 'slave';

    items.push({
      kind: 'bus',
      type: vlnv,
      mode,
      nameHint: name,
      label,
    });
  }

  return items;
}

interface LibraryPaletteProps {
  onCollapse?: () => void;
  busLibrary?: Record<string, unknown>;
}

/**
 * Drag-and-drop primitive library for adding elements to the canvas.
 *
 * Items are grouped by category (protocols, infrastructure). Dragging an item
 * onto the canvas triggers element creation via the drop handler.
 */
export const LibraryPalette: React.FC<LibraryPaletteProps> = ({ onCollapse, busLibrary }) => {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCategory = useCallback((title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  }, []);

  const handleDragStart = useCallback((e: DragEvent, item: LibraryDragPayload) => {
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  return (
    <div className="library-palette">
      {/* Header */}
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

      {/* Hint */}
      <div className="library-palette__hint">Drag items onto the canvas to add them</div>

      {/* Categories */}
      {PALETTE.map((category) => (
        <div key={category.title} className="library-palette__category">
          <button
            className="library-palette__category-header"
            onClick={() => toggleCategory(category.title)}
            type="button"
          >
            <span
              className={`codicon codicon-chevron-${collapsed[category.title] ? 'right' : 'down'}`}
            ></span>
            <span>{category.title}</span>
          </button>

          {!collapsed[category.title] && (
            <div className="library-palette__items">
              {category.items.map((item) => (
                <div
                  key={`${item.kind}-${item.nameHint}`}
                  className="library-palette__item"
                  draggable
                  onDragStart={(e) => handleDragStart(e, item)}
                >
                  <span className={`codicon ${paletteItemIcon(item)}`}></span>
                  <span className="library-palette__item-label">{item.label}</span>
                  <span className="library-palette__item-kind">{kindBadge(item)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* User Interfaces (from busLibraryPaths setting) */}
      {busLibrary &&
        (() => {
          const userItems = buildUserBusItems(busLibrary);
          if (userItems.length === 0) {
            return null;
          }
          const categoryTitle = 'User Interfaces';
          return (
            <div key={categoryTitle} className="library-palette__category">
              <button
                className="library-palette__category-header"
                onClick={() => toggleCategory(categoryTitle)}
                type="button"
              >
                <span
                  className={`codicon codicon-chevron-${collapsed[categoryTitle] ? 'right' : 'down'}`}
                ></span>
                <span>{categoryTitle}</span>
              </button>

              {!collapsed[categoryTitle] && (
                <div className="library-palette__items">
                  {userItems.map((item) => (
                    <div
                      key={`${item.kind}-${item.nameHint}`}
                      className="library-palette__item"
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                    >
                      <span className={`codicon ${paletteItemIcon(item)}`}></span>
                      <span className="library-palette__item-label">{item.label}</span>
                      <span className="library-palette__item-kind">{kindBadge(item)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
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
      return 'codicon-arrow-left';
  }
}

function kindBadge(item: LibraryDragPayload): string {
  if (item.kind === 'interrupt') {
    return item.direction === 'in' ? 'irq-in' : 'irq-out';
  }
  if (item.kind === 'port' && item.direction) {
    return item.direction === 'in' ? 'in' : item.direction === 'out' ? 'out' : 'io';
  }
  if (item.kind === 'parameter' && item.dataType) {
    return item.dataType;
  }
  return '';
}

export { DRAG_MIME };
