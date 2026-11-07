import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { clampMenuPosition } from './layout/menuPosition';

export interface ContextMenuSwatch {
  label: string;
  color: string;
  onSelect: () => void;
}

export interface ContextMenuItem {
  label: string;
  disabled?: boolean;
  swatches?: readonly ContextMenuSwatch[];
  onSelect: () => void;
}

interface DiagramContextMenuProps {
  /** Pointer position relative to the canvas. */
  x: number;
  y: number;
  /** Canvas size the menu is kept inside. */
  canvasWidth: number;
  canvasHeight: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * Small keyboard-operable menu. Arrows, Home and End move the active item;
 * Enter or Space activates it. Escape, an outside click, scrolling, or focus
 * leaving closes it, and focus returns to where it was before the menu opened.
 */
export function DiagramContextMenu({
  x,
  y,
  canvasWidth,
  canvasHeight,
  items,
  onClose,
}: DiagramContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const idPrefix = useId();
  const [active, setActive] = useState(() => items.findIndex((item) => !item.disabled));

  useLayoutEffect(() => {
    const menu = ref.current;
    setPosition(
      clampMenuPosition(
        x,
        y,
        { width: menu?.offsetWidth ?? 0, height: menu?.offsetHeight ?? 0 },
        { width: canvasWidth, height: canvasHeight }
      )
    );
  }, [x, y, canvasWidth, canvasHeight]);

  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    const closeOutside = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', closeOutside, true);
    document.addEventListener('wheel', closeOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside, true);
      document.removeEventListener('wheel', closeOutside, true);
    };
  }, [onClose]);

  const activate = (item: ContextMenuItem | undefined) => {
    if (item && !item.disabled) {
      onClose();
      item.onSelect();
    }
  };
  const move = (step: 1 | -1) => {
    for (let i = 1; i <= items.length; i += 1) {
      const index = (active + step * i + items.length) % items.length;
      if (!items[index].disabled) {
        setActive(index);
        return;
      }
    }
  };
  const moveTo = (index: number) => {
    if (index >= 0) {
      setActive(index);
    }
  };
  const itemId = (index: number) => `${idPrefix}-item-${index}`;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Diagram actions"
      tabIndex={-1}
      aria-activedescendant={active >= 0 ? itemId(active) : undefined}
      className="sd-menu"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          move(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          moveTo(items.findIndex((item) => !item.disabled));
        } else if (event.key === 'End') {
          event.preventDefault();
          moveTo(items.map((item) => !item.disabled).lastIndexOf(true));
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(items[active]);
        }
      }}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          id={itemId(index)}
          role="menuitem"
          aria-disabled={item.disabled ? true : undefined}
          className={`sd-menu-item${item.swatches ? ' sd-menu-item-swatches' : ''}${index === active ? ' sd-menu-item-active' : ''}`}
          onMouseEnter={() => !item.disabled && setActive(index)}
          onClick={() => activate(item)}
        >
          {item.label}
          {item.swatches && (
            <span className="sd-menu-swatches">
              {item.swatches.map((swatch) => (
                <button
                  key={swatch.label}
                  type="button"
                  className="sd-swatch"
                  aria-label={`Highlight ${swatch.label}`}
                  title={swatch.label}
                  style={{ background: swatch.color }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                    swatch.onSelect();
                  }}
                />
              ))}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
