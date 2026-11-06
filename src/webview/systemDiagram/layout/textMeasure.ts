import { BADGE_CHAR_WIDTH } from './netBadges';
import type { TextMeasure, TextWeight } from './nodeSizing';

const FONT_SIZE = 11;
/** Block names are drawn at 12 px semibold, subtitles at 10.5 px in the editor font. */
const NAME_FONT_SIZE = 12;
const SUBTITLE_FONT_SIZE = 10.5;
const SEMIBOLD_CHAR_WIDTH = 7.6;
const SUBTITLE_CHAR_WIDTH = 6.4;

const CHAR_WIDTH: Record<TextWeight, number> = {
  normal: BADGE_CHAR_WIDTH,
  semibold: SEMIBOLD_CHAR_WIDTH,
  subtitle: SUBTITLE_CHAR_WIDTH,
};

function canvasFont(weight: TextWeight, fontFamily: string, monoFamily: string): string {
  switch (weight) {
    case 'semibold':
      return `600 ${NAME_FONT_SIZE}px ${fontFamily}`;
    case 'subtitle':
      return `${SUBTITLE_FONT_SIZE}px ${monoFamily}`;
    default:
      return `${FONT_SIZE}px ${fontFamily}`;
  }
}

/** Canvas-backed text measurer; estimates by length where no canvas exists (jsdom). */
export function createTextMeasurer(fontFamily: string, monoFamily = 'monospace'): TextMeasure {
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
      ctx.font = canvasFont(weight, fontFamily, monoFamily);
      width = ctx.measureText(text).width;
    } else {
      width = text.length * CHAR_WIDTH[weight];
    }
    cache.set(key, width);
    return width;
  };
}
