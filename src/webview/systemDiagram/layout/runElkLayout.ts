import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';

// The bundled build lays out in-thread through a fake worker and needs no
// eval or real Worker, so the webview CSP stays unchanged.
const elk = new ELK();

export function runElkLayout(input: ElkNode): Promise<ElkNode> {
  return elk.layout(input);
}
