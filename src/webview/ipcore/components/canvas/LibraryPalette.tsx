import React, { useState, useCallback, type DragEvent } from 'react';

/** Payload attached to drag events from the library palette */
export interface LibraryDragPayload {
  kind: 'bus' | 'clock' | 'reset' | 'port' | 'parameter';
  /** Bus type VLNV (only for kind=bus) */
  type?: string;
  /** Bus mode: slave/master/sink/source (only for kind=bus) */
  mode?: string;
  /** Port direction (only for kind=port) */
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
    title: 'Bus Protocols',
    items: [
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi4_lite.1.0',
        mode: 'slave',
        nameHint: 's_axi',
        label: 'AXI4-Lite Slave',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi4_lite.1.0',
        mode: 'master',
        nameHint: 'm_axi',
        label: 'AXI4-Lite Master',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi4_full.1.0',
        mode: 'slave',
        nameHint: 's_axi_full',
        label: 'AXI4-Full Slave',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi4_full.1.0',
        mode: 'master',
        nameHint: 'm_axi_full',
        label: 'AXI4-Full Master',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi_stream.1.0',
        mode: 'sink',
        nameHint: 's_axis',
        label: 'AXI-Stream Sink',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.axi_stream.1.0',
        mode: 'source',
        nameHint: 'm_axis',
        label: 'AXI-Stream Source',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.avalon_mm.1.0',
        mode: 'slave',
        nameHint: 'avl',
        label: 'Avalon-MM Slave',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.avalon_mm.1.0',
        mode: 'master',
        nameHint: 'avl_m',
        label: 'Avalon-MM Master',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.avalon_st.1.0',
        mode: 'sink',
        nameHint: 'avl_st_in',
        label: 'Avalon-ST Sink',
      },
      {
        kind: 'bus',
        type: 'ipcraft.busif.avalon_st.1.0',
        mode: 'source',
        nameHint: 'avl_st_out',
        label: 'Avalon-ST Source',
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
  {
    title: 'Infrastructure',
    items: [
      { kind: 'clock', nameHint: 'clk', label: 'Clock' },
      { kind: 'reset', nameHint: 'rst_n', label: 'Reset' },
      { kind: 'port', direction: 'out', nameHint: 'irq', label: 'Interrupt (output)' },
      { kind: 'port', direction: 'in', nameHint: 'port_in', label: 'Input Port' },
      { kind: 'port', direction: 'out', nameHint: 'port_out', label: 'Output Port' },
      { kind: 'port', direction: 'inout', nameHint: 'port_io', label: 'Inout Port' },
    ],
  },
  {
    title: 'Generics',
    items: [
      { kind: 'parameter', dataType: 'integer', nameHint: 'DATA_WIDTH', label: 'Integer Generic' },
      { kind: 'parameter', dataType: 'natural', nameHint: 'DEPTH', label: 'Natural Generic' },
      { kind: 'parameter', dataType: 'boolean', nameHint: 'ENABLE', label: 'Boolean Generic' },
      { kind: 'parameter', dataType: 'string', nameHint: 'INIT_FILE', label: 'String Generic' },
    ],
  },
];

interface LibraryPaletteProps {
  onCollapse?: () => void;
}

/**
 * Drag-and-drop primitive library for adding elements to the canvas.
 *
 * Items are grouped by category (protocols, infrastructure). Dragging an item
 * onto the canvas triggers element creation via the drop handler.
 */
export const LibraryPalette: React.FC<LibraryPaletteProps> = ({ onCollapse }) => {
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
    case 'port':
      if (item.direction === 'in') {
        return 'codicon-arrow-right';
      }
      return 'codicon-arrow-left';
  }
}

function kindBadge(item: LibraryDragPayload): string {
  if (item.kind === 'bus' && item.mode) {
    switch (item.mode) {
      case 'slave':
        return 'S';
      case 'master':
        return 'M';
      case 'sink':
        return 'Sink';
      case 'source':
        return 'Src';
      default:
        return item.mode;
    }
  }
  if (item.kind === 'port' && item.direction) {
    return item.direction === 'in' ? 'in' : 'out';
  }
  if (item.kind === 'parameter' && item.dataType) {
    return item.dataType;
  }
  return '';
}

export { DRAG_MIME };
