import React, { useEffect, useState } from 'react';

interface TooltipState {
  text: string;
  left: number;
  top: number;
  above: boolean;
}

function tooltipTarget(target: EventTarget | null): HTMLButtonElement | null {
  return target instanceof Element
    ? target.closest<HTMLButtonElement>('button[data-tooltip]')
    : null;
}

export function ButtonTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    const show = (event: Event) => {
      const button = tooltipTarget(event.target);
      const text = button?.dataset.tooltip;
      if (!button || !text) {
        return;
      }
      const bounds = button.getBoundingClientRect();
      const above = bounds.bottom + 44 > window.innerHeight;
      setTooltip({
        text,
        left: Math.max(130, Math.min(window.innerWidth - 130, bounds.left + bounds.width / 2)),
        top: above ? bounds.top - 8 : bounds.bottom + 8,
        above,
      });
    };
    const hide = (event: Event) => {
      const button = tooltipTarget(event.target);
      const relatedTarget =
        event instanceof MouseEvent || event instanceof FocusEvent ? event.relatedTarget : null;
      if (button && relatedTarget instanceof Node && button.contains(relatedTarget)) {
        return;
      }
      setTooltip(null);
    };

    document.addEventListener('pointerover', show);
    document.addEventListener('pointerout', hide);
    document.addEventListener('focusin', show);
    document.addEventListener('focusout', hide);
    return () => {
      document.removeEventListener('pointerover', show);
      document.removeEventListener('pointerout', hide);
      document.removeEventListener('focusin', show);
      document.removeEventListener('focusout', hide);
    };
  }, []);

  return tooltip ? (
    <div
      className={`di-button-tooltip ${tooltip.above ? 'is-above' : ''}`}
      role="tooltip"
      style={{ left: tooltip.left, top: tooltip.top }}
    >
      {tooltip.text}
    </div>
  ) : null;
}
