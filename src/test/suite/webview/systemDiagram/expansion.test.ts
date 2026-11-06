import {
  isShownNode,
  levelNodeOf,
  pruneExpanded,
  shownLevels,
  targetLevel,
  viewLevel,
} from '../../../../webview/systemDiagram/expansion';
import { boundaryId } from '../../../../webview/systemDiagram/model';
import { loadFixtureGraph } from './fixtureGraph';

const graph = loadFixtureGraph();
const DSP = '/dsp_pipeline';
const BANK = '/dsp_pipeline/coeff_bank';
const none: ReadonlySet<string> = new Set();
const dsp: ReadonlySet<string> = new Set([DSP]);
const both: ReadonlySet<string> = new Set([DSP, BANK]);

describe('shownLevels', () => {
  it('is the level alone without expansion', () => {
    expect([...shownLevels(graph, '/', none)]).toEqual(['/']);
  });

  it('adds the level of every expanded block, recursively', () => {
    expect([...shownLevels(graph, '/', dsp)]).toEqual(['/', DSP]);
    expect([...shownLevels(graph, '/', both)]).toEqual(['/', DSP, BANK]);
  });

  it('ignores an expanded block whose level is not shown', () => {
    expect([...shownLevels(graph, '/', new Set([BANK]))]).toEqual(['/']);
    expect([...shownLevels(graph, DSP, dsp)]).toEqual([DSP]);
  });

  it('ignores expanded paths that are not hierarchy instances', () => {
    expect([...shownLevels(graph, '/', new Set(['/axi_dma_0']))]).toEqual(['/']);
  });
});

describe('isShownNode', () => {
  it('shows the instances and boundary pins of the level alone without expansion', () => {
    expect(isShownNode(graph, '/', none, '/axi_dma_0')).toBe(true);
    expect(isShownNode(graph, '/', none, boundaryId('/', 'ext_trigger'))).toBe(true);
    expect(isShownNode(graph, '/', none, `${DSP}/fir_compiler_0`)).toBe(false);
  });

  it('shows the instances inside an expanded block, nested ones included', () => {
    expect(isShownNode(graph, '/', dsp, `${DSP}/fir_compiler_0`)).toBe(true);
    expect(isShownNode(graph, '/', dsp, `${BANK}/config_fifo`)).toBe(false);
    expect(isShownNode(graph, '/', both, `${BANK}/config_fifo`)).toBe(true);
  });

  it('shows the boundary pins of the level only, not those of an expanded block', () => {
    expect(isShownNode(graph, '/', dsp, boundaryId(DSP, 'S_AXIS'))).toBe(false);
    expect(isShownNode(graph, DSP, dsp, boundaryId(DSP, 'S_AXIS'))).toBe(true);
  });

  it('does not show an unknown node', () => {
    expect(isShownNode(graph, '/', dsp, '/nope')).toBe(false);
  });
});

describe('viewLevel', () => {
  const inner = { kind: 'instance', id: `${DSP}/fir_compiler_0` } as const;

  it('goes to the level of an instance that is not on screen, as before', () => {
    expect(viewLevel(graph, '/', none, inner)).toBe(DSP);
  });

  it('keeps the level for an instance shown through an expanded block', () => {
    expect(viewLevel(graph, '/', dsp, inner)).toBe('/');
    expect(viewLevel(graph, '/', dsp, { kind: 'instance', id: `${BANK}/config_fifo` })).toBe(BANK);
  });

  it('keeps the level for nets of a shown level only', () => {
    const innerNet = { kind: 'net', id: `${DSP}::Conn1` } as const;
    expect(viewLevel(graph, '/', none, innerNet)).toBe(DSP);
    expect(viewLevel(graph, '/', dsp, innerNet)).toBe('/');
  });

  it('goes to the level of a boundary pin that is not a node of the level on show', () => {
    const boundary = { kind: 'boundary', id: boundaryId(DSP, 'aclk') } as const;
    expect(viewLevel(graph, '/', dsp, boundary)).toBe(DSP);
    expect(viewLevel(graph, DSP, dsp, boundary)).toBe(DSP);
  });

  it('is undefined for a selection that does not exist', () => {
    expect(viewLevel(graph, '/', dsp, { kind: 'instance', id: '/nope' })).toBeUndefined();
    expect(viewLevel(graph, '/', dsp, { kind: 'net', id: 'nope' })).toBeUndefined();
  });
});

describe('targetLevel', () => {
  const inner = { kind: 'instance', id: `${DSP}/fir_compiler_0` } as const;

  it('keeps the current level for no selection and no level', () => {
    expect(targetLevel(graph, '/', dsp, null)).toBeUndefined();
  });

  it('follows the selection when no level is given', () => {
    expect(targetLevel(graph, '/', none, inner)).toBe(DSP);
    expect(targetLevel(graph, '/', dsp, inner)).toBe('/');
  });

  it('takes an explicit level, unless that level is drawn inside an expanded block', () => {
    expect(targetLevel(graph, '/', none, inner, DSP)).toBe(DSP);
    expect(targetLevel(graph, '/', dsp, inner, DSP)).toBe('/');
    expect(targetLevel(graph, DSP, dsp, null, '/')).toBe('/');
  });

  it('always opens the level of a boundary pin that is not a node of this level', () => {
    const boundary = { kind: 'boundary', id: boundaryId(DSP, 'aclk') } as const;
    expect(targetLevel(graph, '/', dsp, boundary, DSP)).toBe(DSP);
    expect(targetLevel(graph, '/', none, boundary, DSP)).toBe(DSP);
  });
});

describe('levelNodeOf', () => {
  it('is the instance itself when it sits on the level', () => {
    expect(levelNodeOf('/', '/axi_dma_0')).toBe('/axi_dma_0');
    expect(levelNodeOf(DSP, `${DSP}/coeff_bank`)).toBe(`${DSP}/coeff_bank`);
  });

  it('is the outermost block of the level that contains a deeper instance', () => {
    expect(levelNodeOf('/', `${DSP}/fir_compiler_0`)).toBe(DSP);
    expect(levelNodeOf('/', `${BANK}/config_fifo`)).toBe(DSP);
    expect(levelNodeOf(DSP, `${BANK}/config_fifo`)).toBe(BANK);
  });
});

describe('pruneExpanded', () => {
  it('returns the same set when every path is still a hierarchy instance', () => {
    expect(pruneExpanded(graph, both)).toBe(both);
    expect(pruneExpanded(graph, none)).toBe(none);
  });

  it('drops paths that vanished or are not hierarchies', () => {
    const pruned = pruneExpanded(graph, new Set([DSP, '/gone', '/axi_dma_0']));
    expect([...pruned]).toEqual([DSP]);
  });
});
