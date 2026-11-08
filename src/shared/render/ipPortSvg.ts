/**
 * Ports of the IP core symbol as native SVG: single-signal stubs (clock, reset, interrupt, data
 * port) and collapsed bus bundles. Mirrors CanvasPort.tsx and CanvasBusBundle.tsx, with styles
 * from canvas.css resolved through `Palette.ip`. Default, non-interactive state only.
 */

import { STUB_LENGTH, type LayoutPort } from '../../webview/ipcore/components/canvas/canvasLayout';
import type { Palette } from './palette';
import { attributes, element, num } from './svg';
import { drawText, drawTextOnBaseline } from './textSvg';

export interface PortDrawContext {
  palette: Palette;
  /** The color of a clock domain, or undefined when ports are not colored by domain. */
  domainColor: (clockDomainIdx: number) => string | undefined;
  /** Whether a bus bundle shows the expand toggle (its signal definitions are known). */
  expandable: (port: LayoutPort) => boolean;
}

const INTERRUPT_MARKER = {
  LEVEL_HIGH: 'H',
  LEVEL_LOW: 'L',
  EDGE_RISING: 'R',
  EDGE_FALLING: 'F',
} as const;

const BADGE_OFFSET = 13;

const group = (attrs: Parameters<typeof attributes>[0], inner: string) =>
  `<g ${attributes(attrs)}>${inner}</g>`;
const at = (x: number, y: number) => `translate(${num(x)} ${num(y)})`;

/** The stroke/fill color of a port kind (canvas-port--clock and friends). */
function kindColor(port: LayoutPort, palette: Palette): string {
  switch (port.kind) {
    case 'clock':
      return palette.ip.clock;
    case 'reset':
      return palette.ip.reset;
    case 'interrupt':
      return palette.ip.interrupt;
    default:
      return palette.foreground;
  }
}

function directionArrow(port: LayoutPort, x: number, y: number, fill: string): string {
  const direction = port.direction;
  if (!direction) {
    return '';
  }
  let shapes: string;
  if (direction === 'inout') {
    shapes =
      element('polygon', { points: '0,-7 -3.5,-3 3.5,-3', fill }) +
      element('polygon', { points: '0,7 -3.5,3 3.5,3', fill });
  } else {
    const pointsRight =
      (port.side === 'left' && direction === 'in') || (port.side !== 'left' && direction === 'out');
    shapes = element('polygon', {
      points: pointsRight ? '5,0 -1,-3.5 -1,3.5' : '-5,0 1,-3.5 1,3.5',
      fill,
    });
  }
  return group({ transform: at(x, y), opacity: 0.55 }, shapes);
}

function badge(x: number, marker: string, color: string, palette: Palette): string {
  return group(
    { transform: at(x, 0) },
    element('rect', {
      x: -5,
      y: -5,
      width: 10,
      height: 10,
      rx: 3,
      fill: palette.ip.bodyFill,
      stroke: color,
      'stroke-width': 1,
    }) +
      drawText(0, 0, marker, {
        face: 'mono400',
        sizePx: 7,
        fill: color,
        anchor: 'middle',
        weight: 700,
      })
  );
}

/** The clock, reset or interrupt icon drawn inside the block next to the stub. */
function kindIcon(port: LayoutPort, domain: string | undefined, palette: Palette): string {
  const { side } = port;
  const x = side === 'left' ? port.x + 14 : side === 'right' ? port.x - 14 : port.x;
  const y = side === 'bottom' ? port.y - 14 : port.y;
  const badgeX = side === 'right' ? -BADGE_OFFSET : BADGE_OFFSET;
  const ink = domain ?? palette.foreground;
  let inner: string;
  if (port.kind === 'clock') {
    inner =
      element('circle', {
        cx: 0,
        cy: 0,
        r: 5,
        fill: 'none',
        stroke: palette.foreground,
        'stroke-width': 1.2,
      }) +
      element('line', {
        x1: 0,
        y1: 0,
        x2: -2,
        y2: -3,
        stroke: ink,
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
      }) +
      element('line', {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: -4,
        stroke: ink,
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
      });
  } else if (port.kind === 'reset') {
    inner =
      element('path', {
        d: 'M 0 -4.5 A 4.5 4.5 0 1 1 -4.5 0',
        fill: 'none',
        stroke: ink,
        'stroke-width': 1.3,
        'stroke-linecap': 'round',
      }) +
      element('polygon', { points: '-4.5,0 -6.5,-2 -2.5,-2', fill: ink }) +
      badge(badgeX, port.polarity === 'activeLow' ? 'L' : 'H', palette.ip.yellow, palette);
  } else {
    inner =
      element('polygon', {
        points: '1,-5 -2,0 1,0 -1,5 2,0 -1,0',
        fill: domain ?? palette.ip.interrupt,
      }) +
      badge(badgeX, INTERRUPT_MARKER[port.sensitivity ?? 'LEVEL_HIGH'], palette.ip.yellow, palette);
  }
  return group({ transform: at(x, y), opacity: 0.75 }, inner);
}

/** A clock, reset, interrupt or data port: stub, dot, direction arrow, icon, label and width. */
export function portSvg(port: LayoutPort, ctx: PortDrawContext): string {
  const { palette } = ctx;
  const domain = ctx.domainColor(port.clockDomainIdx);
  const color = domain ?? kindColor(port, palette);
  const isLeft = port.side === 'left';
  const isRight = port.side === 'right';
  const isBottom = port.side === 'bottom';
  const x2 = isLeft ? port.x - STUB_LENGTH : isRight ? port.x + STUB_LENGTH : port.x;
  const y2 = isBottom ? port.y + STUB_LENGTH : port.y;
  const parts: string[] = [
    element('line', {
      x1: port.x,
      y1: port.y,
      x2,
      y2,
      stroke: color,
      'stroke-width': 1.5,
      opacity: 0.6,
    }),
  ];

  if (port.kind === 'reset' && port.polarity === 'activeLow') {
    parts.push(
      element('circle', {
        cx: port.x,
        cy: port.y,
        r: 4,
        fill: palette.ip.bodyFill,
        stroke: domain ?? palette.ip.reset,
        'stroke-width': 1.5,
      })
    );
  } else {
    parts.push(element('circle', { cx: port.x, cy: port.y, r: 3, fill: color, opacity: 0.7 }));
  }

  parts.push(
    directionArrow(
      port,
      isLeft ? port.x - STUB_LENGTH / 2 : isRight ? port.x + STUB_LENGTH / 2 : port.x,
      isBottom ? port.y + STUB_LENGTH / 2 : port.y,
      domain ?? palette.foreground
    )
  );
  if (port.kind === 'clock' || port.kind === 'reset' || port.kind === 'interrupt') {
    parts.push(kindIcon(port, domain, palette));
  }

  const labelStyle = { face: 'mono400', sizePx: 11, fill: palette.foreground } as const;
  if (isBottom) {
    parts.push(
      drawText(port.x, port.y + STUB_LENGTH + 14, String(port.label ?? ''), {
        ...labelStyle,
        anchor: 'middle',
      })
    );
  } else {
    parts.push(
      drawText(
        port.x + (isLeft ? -STUB_LENGTH - 6 : STUB_LENGTH + 6),
        port.y,
        String(port.label ?? ''),
        {
          ...labelStyle,
          anchor: isLeft ? 'end' : 'start',
        }
      )
    );
  }

  if (port.widthLabel) {
    const widthStyle = {
      face: 'mono400',
      sizePx: 9,
      fill: palette.descriptionForeground,
      anchor: 'middle',
      opacity: 0.6,
    } as const;
    parts.push(
      isBottom
        ? drawTextOnBaseline(port.x + 12, port.y + STUB_LENGTH / 2, port.widthLabel, widthStyle)
        : drawTextOnBaseline(
            port.x + (isLeft ? -STUB_LENGTH / 2 : STUB_LENGTH / 2),
            port.y - 10,
            port.widthLabel,
            widthStyle
          )
    );
  }
  return parts.join('');
}

/** A small filled triangle standing in for the canvas's ▼ glyph on the expand toggle. */
function toggleArrow(x: number, fill: string): string {
  return element('polygon', {
    points: `${num(x - 3.5)},-2.5 ${num(x + 3.5)},-2.5 ${num(x)},3`,
    fill,
  });
}

/** A collapsed bus bundle: thick stub, connector, protocol badge, mode, name and badges. */
export function busBundleSvg(port: LayoutPort, ctx: PortDrawContext): string {
  const { palette } = ctx;
  const { ip } = palette;
  const domain = ctx.domainColor(port.clockDomainIdx);
  const isLeft = port.side === 'left';
  const dir = isLeft ? -1 : 1;
  const stubEndX = port.x + dir * STUB_LENGTH;
  const expandable = ctx.expandable(port);
  const toggleW = 16;
  const toggleGap = 4;
  const badgeX = stubEndX + dir * (expandable ? toggleGap + toggleW + 4 : 8);
  const busColor = domain ?? ip.bus;
  const nameYOffset = port.memoryMapRef ? -5 : 0;
  const parts: string[] = [
    element('line', {
      x1: port.x,
      y1: port.y,
      x2: stubEndX,
      y2: port.y,
      stroke: busColor,
      'stroke-width': 4,
      opacity: 0.8,
    }),
    element('rect', {
      x: port.x - 4,
      y: port.y - 6,
      width: 8,
      height: 12,
      rx: 2,
      fill: busColor,
      opacity: 0.9,
    }),
  ];

  // Protocol badge, past the toggle so the two never overlap.
  let badgeSvg =
    element('rect', {
      x: isLeft ? -80 : 0,
      y: -10,
      width: 80,
      height: 20,
      rx: 4,
      fill: ip.busBadgeFill,
      stroke: domain ?? ip.bus,
      'stroke-width': 1,
      opacity: 0.9,
    }) +
    drawText(isLeft ? -40 : 40, 0, port.protocol ?? 'Bus', {
      face: 'sans600',
      sizePx: 10,
      fill: palette.foreground,
      anchor: 'middle',
    });
  if ((port.arrayCount ?? 0) > 1) {
    badgeSvg +=
      element('rect', {
        x: isLeft ? -13 : 67,
        y: -20,
        width: 22,
        height: 14,
        rx: 4,
        fill: ip.arrayFill,
        stroke: ip.arrayStroke,
        'stroke-width': 1.5,
      }) +
      drawText(isLeft ? -2 : 78, -13, `×${port.arrayCount}`, {
        face: 'mono400',
        sizePx: 9,
        fill: palette.foreground,
        anchor: 'middle',
        weight: 700,
      });
  }
  parts.push(group({ transform: at(badgeX, port.y) }, badgeSvg));

  if (port.mode) {
    parts.push(
      group(
        { transform: at(port.x + dir * (STUB_LENGTH / 2), port.y - 12) },
        element('rect', {
          x: -14,
          y: -8,
          width: 28,
          height: 16,
          rx: 3,
          fill: ip.modeFill,
          stroke: ip.modeStroke,
          'stroke-width': 1,
        }) +
          drawText(0, 0, port.mode, {
            face: 'mono400',
            sizePx: 9,
            fill: palette.foreground,
            anchor: 'middle',
            weight: 700,
          })
      )
    );
  }

  parts.push(
    drawText(port.x + (isLeft ? 12 : -12), port.y + nameYOffset, String(port.label ?? ''), {
      face: 'mono400',
      sizePx: 10,
      fill: palette.foreground,
      anchor: isLeft ? 'start' : 'end',
      opacity: 0.8,
    })
  );

  if (port.memoryMapRef) {
    const mapName = String(port.memoryMapRef);
    const ref = mapName.length > 10 ? `${mapName.slice(0, 9)}…` : mapName;
    parts.push(
      group(
        { transform: at(port.x + (isLeft ? 14 : -14), port.y + 7) },
        element('rect', {
          x: isLeft ? 0 : -60,
          y: -6,
          width: 60,
          height: 12,
          rx: 3,
          fill: ip.mmapFill,
          stroke: ip.mmapStroke,
          'stroke-width': 1,
          opacity: 0.9,
        }) +
          drawText(isLeft ? 30 : -30, 0, ref, {
            face: 'mono400',
            sizePx: 7,
            fill: ip.mmapStroke,
            anchor: 'middle',
            weight: 600,
          })
      )
    );
  }

  if (expandable) {
    parts.push(
      group(
        { transform: at(stubEndX + dir * toggleGap, port.y), 'data-part': 'expand-toggle' },
        element('rect', {
          x: isLeft ? -toggleW : 0,
          y: -8,
          width: toggleW,
          height: 16,
          rx: 3,
          fill: ip.busToggleFill,
          stroke: ip.bus,
          'stroke-width': 1,
          opacity: 0.8,
        }) + toggleArrow(isLeft ? -toggleW / 2 : toggleW / 2, ip.bus)
      )
    );
  }
  return parts.join('');
}
