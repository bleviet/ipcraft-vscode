import { isPaneDoubleClick } from '../../../../webview/systemDiagram/canvasTargets';

function dom(html: string): Element {
  document.body.innerHTML = html;
  return document.getElementById('target')!;
}

describe('isPaneDoubleClick', () => {
  it('accepts the pane itself and plain content of it', () => {
    expect(isPaneDoubleClick(dom('<div class="react-flow__pane" id="target"></div>'))).toBe(true);
    expect(
      isPaneDoubleClick(
        dom(
          '<div class="react-flow__pane"><div class="react-flow__viewport" id="target"></div></div>'
        )
      )
    ).toBe(true);
  });

  it.each([
    ['node', '<div class="react-flow__node"><span id="target"></span></div>'],
    ['edge', '<svg class="react-flow__edge"><path id="target"></path></svg>'],
    ['panel', '<div class="react-flow__panel"><button id="target"></button></div>'],
    ['controls', '<div class="react-flow__controls"><button id="target"></button></div>'],
    ['badge', '<div class="nodrag nopan"><button id="target"></button></div>'],
  ])('rejects a %s inside the pane', (_name, inner) => {
    expect(isPaneDoubleClick(dom(`<div class="react-flow__pane">${inner}</div>`))).toBe(false);
  });

  it('rejects targets outside the pane', () => {
    expect(isPaneDoubleClick(dom('<div id="target"></div>'))).toBe(false);
  });
});
