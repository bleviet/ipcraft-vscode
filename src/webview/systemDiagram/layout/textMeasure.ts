import { BADGE_CHAR_WIDTH } from './netBadges';
import type { TextMeasure, TextWeight } from './nodeSizing';

const FONT_SIZE = 11;
const SEMIBOLD_CHAR_WIDTH = 7;

/** Canvas-backed text measurer; estimates by length where no canvas exists (jsdom). */
export function createTextMeasurer(fontFamily: string): TextMeasure {
  const cache = new Map<string, number>();
  let context: CanvasRenderingContext2D | null | undefined;
  const canvasContext = (): CanvasRenderingContext2D | null => {
    if (context === undefined) {
      context = document.createElement('canvas').getContext('2d');
    }
    return context;
  };
  return (text: string, weight: TextWeight): number => {
    const key = `${weight}|${text}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const ctx = canvasContext();
    let width: number;
    if (ctx) {
      ctx.font = `${weight === 'semibold' ? '600 ' : ''}${FONT_SIZE}px ${fontFamily}`;
      width = ctx.measureText(text).width;
    } else {
      width = text.length * (weight === 'semibold' ? SEMIBOLD_CHAR_WIDTH : BADGE_CHAR_WIDTH);
    }
    cache.set(key, width);
    return width;
  };
}
