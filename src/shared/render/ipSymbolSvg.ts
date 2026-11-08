/**
 * Draws the IP core symbol as a standalone SVG: the picture the IP core editor's canvas shows in
 * its default, non-interactive state. Pure and Node-safe (native SVG elements only: no DOM,
 * React, CSS classes, `foreignObject` or `var()` colors). Output is deterministic.
 *
 * Mirrors IpBlockDiagram.tsx, CanvasPort.tsx and CanvasBusBundle.tsx (geometry from
 * canvasLayout.ts, styles from canvas.css, colors from `Palette.ip`). Deliberate simplifications:
 * - no selection, hover, drag, search dimming, rename, validation dots or warning badges, and
 *   bus bundles are always collapsed (`layout.subPorts` is not drawn);
 * - no block drop shadow;
 * - the canvas margin is cropped to the drawing plus a 24 px margin;
 * - glyphs outside the embedded fonts (the generics and dependency icons, the toggle arrow) are
 *   drawn as small native shapes;
 * - the mono core name and badge texts use the 400 face; the bold weight is synthesized by the
 *   viewer, as it is for the canvas;
 * - section headers are written in capitals instead of `text-transform: uppercase`;
 * - grid dots are 1.5 px across (the canvas draws 1 px) so they survive printing.
 */

import {
  type CanvasLayout,
  type LayoutPort,
  WRAPPED_TITLE_ROW_HEIGHT,
  STUB_LENGTH,
} from '../../webview/ipcore/components/canvas/canvasLayout';
import { busBundleSvg, portSvg, type PortDrawContext } from './ipPortSvg';
import type { Palette } from './palette';
import { attributes, element, num, SVG_TEXT_STYLE } from './svg';
import { measureText } from './textMetrics';
import { drawText, drawTextOnBaseline } from './textSvg';

export interface IpSymbolOptions {
  palette: Palette;
  grid: boolean;
  background: 'editor' | 'transparent';
  /** `@font-face` rules for the `<style>` element; see fontFaces.ts. */
  fontFaceCss: string;
  /** Crop to this rectangle of layout coordinates, within the drawing; absent: the whole drawing. */
  crop?: Box;
  /** The color of a clock domain; leave out to draw ports in their kind colors. */
  domainColor?: (clockDomainIdx: number) => string | undefined;
  /** Whether a bus bundle shows the expand toggle; leave out for none. */
  expandable?: (port: LayoutPort) => boolean;
}

const MARGIN = 24;
const GRID_GAP = 20;
const GRID_DOT_RADIUS = 0.75;
/** Horizontal reach of a collapsed bus bundle with its toggle and badge, from the block edge. */
const BUS_REACH = STUB_LENGTH + 4 + 16 + 4 + 80;
/** The array-count badge of a right-side bundle sticks out past the protocol badge by this much. */
const ARRAY_BADGE_OVERHANG = 9;
/** Room below a bottom port's label baseline. */
const BOTTOM_LABEL_DROP = STUB_LENGTH + 20;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The drawing's extent: the block plus the stubs, labels and badges that stick out of it. */
function symbolBounds(layout: CanvasLayout): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  const { blockRect } = layout;
  let left = blockRect.x;
  let right = blockRect.x + blockRect.width;
  let bottom = blockRect.y + blockRect.height;
  for (const port of layout.ports) {
    if (port.side === 'bottom') {
      const half = measureText(port.label, 'mono400', 11) / 2;
      left = Math.min(left, port.x - half);
      right = Math.max(right, port.x + half);
      bottom = Math.max(bottom, port.y + BOTTOM_LABEL_DROP);
    } else {
      const reach =
        port.kind === 'bus'
          ? BUS_REACH +
            (port.side === 'right' && (port.arrayCount ?? 0) > 1 ? ARRAY_BADGE_OVERHANG : 0)
          : STUB_LENGTH + 6 + measureText(port.label, 'mono400', 11);
      if (port.side === 'left') {
        left = Math.min(left, port.x - reach);
      } else {
        right = Math.max(right, port.x + reach);
      }
    }
  }
  return { left, top: blockRect.y, right, bottom };
}

function gridSvg(box: Box, palette: Palette): string {
  const { color, opacity } = palette.ip.gridDot;
  return [
    `<defs><pattern id="ipcraft-grid" width="${GRID_GAP}" height="${GRID_GAP}" patternUnits="userSpaceOnUse">`,
    element('circle', { cx: 1, cy: 1, r: GRID_DOT_RADIUS, fill: color, 'fill-opacity': opacity }),
    '</pattern></defs>',
    element('rect', { ...box, fill: 'url(#ipcraft-grid)' }),
  ].join('');
}

/** A horizontal section rule inside the block (`.ip-block-param-separator`). */
function separator(x1: number, x2: number, y: number, palette: Palette): string {
  return element('line', {
    x1,
    y1: y,
    x2,
    y2: y,
    stroke: palette.ip.bodyStroke,
    'stroke-width': 1,
    opacity: 0.6,
  });
}

/** A section title such as GENERICS, centred below its rule (`.ip-block-param-header`). */
function sectionHeader(cx: number, y: number, title: string, palette: Palette): string {
  return drawText(cx, y, title, {
    face: 'sans600',
    sizePx: 9,
    fill: palette.descriptionForeground,
    anchor: 'middle',
    letterSpacing: 0.54,
    opacity: 0.55,
  });
}

/** Header values come from user YAML and may be numbers or missing; the canvas renders them as text. */
const str = (value: unknown): string => String(value ?? '');

/** Block body, header stripe, core name and the vendor, library and author rows. */
function headerSvg(layout: CanvasLayout, palette: Palette): string {
  const { blockRect: r, coreNameLines } = layout;
  const titleRowOffset = coreNameLines.length > 1 ? WRAPPED_TITLE_ROW_HEIGHT : 0;
  const cx = r.x + r.width / 2;
  const parts: string[] = [
    element('rect', {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      rx: 6,
      ry: 6,
      fill: palette.ip.bodyFill,
      stroke: palette.ip.bodyStroke,
      'stroke-width': 2,
    }),
    element('rect', {
      x: r.x,
      y: r.y,
      width: r.width,
      height: 28 + titleRowOffset,
      rx: 6,
      ry: 6,
      fill: palette.ip.headerFill,
    }),
    element('rect', {
      x: r.x,
      y: r.y + 14,
      width: r.width,
      height: 14 + titleRowOffset,
      fill: palette.ip.headerFill,
    }),
  ];
  coreNameLines.forEach((line, index) => {
    parts.push(
      drawText(cx, r.y + (titleRowOffset ? 9 + index * titleRowOffset : 15), str(line), {
        face: 'mono400',
        sizePx: 13,
        fill: palette.foreground,
        anchor: 'middle',
        weight: 700,
        letterSpacing: 0.52,
      })
    );
  });

  const rows: Array<[string, string, number]> = [
    ['vendor', layout.vendorLabel, 42],
    ['library', layout.libraryLabel, 62],
  ];
  if (layout.authorLabel) {
    rows.push(['author', layout.authorLabel, 82]);
  }
  for (const [name, value, offset] of rows) {
    const y = r.y + offset + titleRowOffset;
    parts.push(
      drawText(r.x + 24, y, name, { face: 'mono400', sizePx: 11, fill: palette.ip.yellow }),
      drawText(r.x + r.width - 24, y, str(value), {
        face: 'mono400',
        sizePx: 10,
        fill: palette.descriptionForeground,
        anchor: 'end',
        opacity: 0.7,
      })
    );
  }
  return parts.join('');
}

/** The chain-link stand-in for the canvas's dependency glyph: two interlocked rounded links. */
function dependencyIcon(x: number, y: number, color: string): string {
  const link = { width: 6, height: 4, rx: 2, fill: 'none', stroke: color, 'stroke-width': 1 };
  return (
    `<g transform="translate(${num(x)} ${num(y)})" opacity="0.8">` +
    element('rect', { x: -5, y: -3.5, ...link }) +
    element('rect', { x: -1, y: -0.5, ...link }) +
    '</g>'
  );
}

/** The outline triangle standing in for the canvas's generic glyph. */
function genericIcon(x: number, y: number, color: string): string {
  return element('polygon', {
    points: `${num(x - 2.5)},${num(y - 3.5)} ${num(x + 3)},${num(y)} ${num(x - 2.5)},${num(y + 3.5)}`,
    fill: 'none',
    stroke: color,
    'stroke-width': 1,
    opacity: 0.8,
  });
}

/** Dependencies (subcores) and Generics sections. */
function sectionsSvg(layout: CanvasLayout, palette: Palette): string {
  const { blockRect: r } = layout;
  const cx = r.x + r.width / 2;
  const parts: string[] = [];
  if (layout.subcoreDeps.length > 0) {
    parts.push(
      separator(r.x + 8, r.x + r.width - 8, layout.depSeparatorY, palette),
      sectionHeader(cx, layout.depSeparatorY + 11, 'DEPENDENCIES', palette)
    );
    for (const dep of layout.subcoreDeps) {
      parts.push(
        dependencyIcon(r.x + 14, dep.y, palette.ip.dependency),
        drawText(r.x + 24, dep.y, str(dep.shortName), {
          face: 'mono400',
          sizePx: 11,
          fill: palette.ip.dependency,
        })
      );
    }
  }
  if (layout.parameters.length > 0) {
    parts.push(
      separator(r.x + 8, r.x + r.width - 8, layout.paramSeparatorY, palette),
      sectionHeader(cx, layout.paramSeparatorY + 11, 'GENERICS', palette)
    );
    for (const param of layout.parameters) {
      const rowY = layout.paramSeparatorY + 26 + param.index * 18;
      parts.push(
        genericIcon(r.x + 14, rowY, palette.ip.yellow),
        drawText(r.x + 24, rowY, str(param.name), {
          face: 'mono400',
          sizePx: 11,
          fill: palette.ip.yellow,
        })
      );
      if (param.value !== '') {
        parts.push(
          drawText(r.x + r.width - 8, rowY, `= ${str(param.value)}`, {
            face: 'mono400',
            sizePx: 10,
            fill: palette.descriptionForeground,
            anchor: 'end',
            opacity: 0.7,
          })
        );
      }
    }
  }
  return parts.join('');
}

/** Ports header, description, and the left and right port counts at the block's bottom corners. */
function footerSvg(layout: CanvasLayout, palette: Palette): string {
  const { blockRect: r } = layout;
  const cx = r.x + r.width / 2;
  const parts: string[] = [];
  if (layout.ports.length > 0) {
    parts.push(
      separator(r.x + 8, r.x + r.width - 8, layout.portSeparatorY, palette),
      sectionHeader(cx, layout.portSeparatorY + 11, 'PORTS', palette)
    );
  }
  if (layout.descLines.length > 0) {
    parts.push(separator(r.x + 12, r.x + r.width - 12, layout.descSeparatorY, palette));
    layout.descLines.forEach((line, index) => {
      parts.push(
        drawTextOnBaseline(cx, layout.descSeparatorY + 10 + (index + 0.5) * 13, str(line), {
          face: 'sans400',
          sizePx: 10,
          fill: palette.descriptionForeground,
          anchor: 'middle',
          opacity: 0.5,
        })
      );
    });
  }
  for (const side of ['left', 'right'] as const) {
    const count = layout.ports.filter((port) => port.side === side).length;
    if (count > 0) {
      parts.push(
        drawTextOnBaseline(
          side === 'left' ? r.x + 12 : r.x + r.width - 12,
          r.y + r.height - 8,
          String(count),
          {
            face: 'mono400',
            sizePx: 9,
            fill: palette.descriptionForeground,
            anchor: 'middle',
            opacity: 0.4,
          }
        )
      );
    }
  }
  return parts.join('');
}

/** `box` limited to `crop`; throws when they do not overlap. */
function cropped(box: Box, crop: Box): Box {
  const left = Math.max(box.x, crop.x);
  const top = Math.max(box.y, crop.y);
  const right = Math.min(box.x + box.width, crop.x + crop.width);
  const bottom = Math.min(box.y + box.height, crop.y + crop.height);
  if (right <= left || bottom <= top) {
    throw new Error('The symbol is not in the visible area');
  }
  // Rounded outwards like the whole box, so the pixel size is a whole number.
  const x = Math.floor(left);
  const y = Math.floor(top);
  return { x, y, width: Math.ceil(right) - x, height: Math.ceil(bottom) - y };
}

export function renderIpSymbolSvg(layout: CanvasLayout, options: IpSymbolOptions): string {
  const { palette } = options;
  const bounds = symbolBounds(layout);
  const x0 = Math.floor(bounds.left - MARGIN);
  const y0 = Math.floor(bounds.top - MARGIN);
  const whole: Box = {
    x: x0,
    y: y0,
    width: Math.ceil(bounds.right + MARGIN - x0),
    height: Math.ceil(bounds.bottom + MARGIN - y0),
  };
  const box = options.crop ? cropped(whole, options.crop) : whole;
  const { x, y, width, height } = box;

  const ctx: PortDrawContext = {
    palette,
    domainColor: options.domainColor ?? (() => undefined),
    expandable: options.expandable ?? (() => false),
  };
  const ports = layout.ports.map((port) => {
    const inner = port.kind === 'bus' ? busBundleSvg(port, ctx) : portSvg(port, ctx);
    return `<g ${attributes({ 'data-port': port.id, 'data-kind': port.kind })}>${inner}</g>`;
  });

  const body = [
    options.background === 'editor' ? element('rect', { ...box, fill: palette.background }) : '',
    options.grid ? gridSvg(box, palette) : '',
    headerSvg(layout, palette),
    sectionsSvg(layout, palette),
    footerSvg(layout, palette),
    ...ports,
  ];
  const root = attributes({
    xmlns: 'http://www.w3.org/2000/svg',
    width,
    height,
    viewBox: `${num(x)} ${num(y)} ${width} ${height}`,
    style: SVG_TEXT_STYLE,
  });
  return `<svg ${root}><style>${options.fontFaceCss}</style>${body.join('')}</svg>\n`;
}
