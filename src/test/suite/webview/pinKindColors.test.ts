import fs from 'fs';
import path from 'path';
import { categoryColor } from '../../../webview/systemDiagram/colors';

const css = fs.readFileSync(
  path.resolve(__dirname, '../../../webview/ipcore/components/canvas/canvas.css'),
  'utf8'
);

/** The declarations of the rule with exactly this selector. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.\\-]/g, '\\$&');
  const match = new RegExp(`^${escaped} \\{([^}]*)\\}`, 'm').exec(css);
  if (!match) {
    throw new Error(`No rule for ${selector}`);
  }
  return match[1];
}

describe('IP canvas port kind colors', () => {
  it.each(['clock', 'reset', 'interrupt'] as const)(
    'draws a %s port in the system viewer color',
    (kind) => {
      const color = categoryColor(kind);
      expect(ruleBody(`.canvas-port--${kind} .canvas-port__stub`)).toContain(`stroke: ${color};`);
      expect(ruleBody(`.canvas-port--${kind} .canvas-port__dot`)).toContain(`fill: ${color};`);
      expect(ruleBody(`.ci-badge--${kind}`)).toContain(`color: ${color};`);
    }
  );

  it('draws the active-low reset bubble and the interrupt icon in their kind colors', () => {
    expect(ruleBody('.canvas-port--reset .canvas-port__inversion-bubble')).toContain(
      `stroke: ${categoryColor('reset')};`
    );
    expect(ruleBody('.canvas-port__icon--interrupt polygon')).toContain(
      `fill: ${categoryColor('interrupt')};`
    );
  });
});
