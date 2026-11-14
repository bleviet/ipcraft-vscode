import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import { findingsBase } from '../../../../../services/systemDiagram/diff/diffFindings';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import type { UnionAdditions } from '../../../../../domain/systemGraphDiff';
import {
  GHOST_NET_PREFIX,
  unionAdditions,
} from '../../../../../services/systemDiagram/diff/unionAdditions';
import { readSystemDesign } from '../../../../../services/systemDiagram/readSystemDesign';
import {
  systemBd,
  withoutGpioBlock,
  withoutNestedSlave,
} from '../../../webview/systemDiagram/systemBdEdit';

const fixtures = path.resolve(__dirname, '../../../../fixtures/system-design/diff');

function read(file: string): SystemGraph {
  return readSystemDesign(
    path.join(fixtures, file),
    file,
    fs.readFileSync(path.join(fixtures, file), 'utf8')
  )!;
}

const additions = (base: SystemGraph, current: SystemGraph): UnionAdditions =>
  unionAdditions(base, current, diffSystemGraphs(base, current));

const ends = (additionsOf: UnionAdditions) =>
  additionsOf.nets.map((net) =>
    net.endpoints.map((end) => `${end.instance ?? '(port)'}:${end.pin}`).sort()
  );

describe('unionAdditions', () => {
  const zynq = { base: read('zynq_gpio_base.bd'), current: read('zynq_gpio_current.bd') };

  it('has nothing to add for identical graphs', () => {
    expect(additions(zynq.base, zynq.base)).toEqual({
      instances: [],
      pins: [],
      boundaryPins: [],
      nets: [],
    });
  });

  it('adds a removed block with its pins, a removed port, and the wire to the block that stays', () => {
    const union = additions(zynq.base, zynq.current);
    expect(union.instances.map((i) => [i.path, i.parent, i.pins.map((p) => p.name)])).toEqual([
      ['/axi_gpio_0', '/', ['S_AXI', 's_axi_aclk']],
    ]);
    expect(union.boundaryPins.map(({ level, pin }) => [level, pin.name])).toEqual([['/', 'led_o']]);
    // The interconnect lost the port the block was on: the wire needs it as its end.
    expect(union.pins.map(({ instance, pin }) => [instance, pin.name])).toEqual([
      ['/axi_periph', 'M00_AXI'],
    ]);
    expect(union.nets.map((net) => net.id)).toEqual([`${GHOST_NET_PREFIX}/::periph_gpio0`]);
    expect(ends(union)).toEqual([['/axi_gpio_0:S_AXI', '/axi_periph:M00_AXI']]);
    expect(zynq.current.instances['/axi_periph'].pins.map((p) => p.name)).not.toContain('M00_AXI');
  });

  it('leaves out the clock and reset wires of a removed block', () => {
    const union = additions(zynq.base, zynq.current);
    expect(union.nets.every((net) => net.category !== 'clock' && net.category !== 'reset')).toBe(
      true
    );
  });

  it('adds the old wire of a rewired pin between two blocks that both stay', () => {
    const [base, current] = [read('nios_base.qsys'), read('nios_current.qsys')];
    const union = additions(base, current);
    // The source fed the sink directly; now a block sits between them.
    expect(union.instances).toEqual([]);
    expect(ends(union)).toContainEqual(['/st_sink_0:sink', '/st_source_0:src']);
    // A wire is added once: the connections the current graph keeps are not repeated.
    expect(union.nets.map((net) => net.id)).toEqual([
      `${GHOST_NET_PREFIX}/::st_source_0.src`,
      `${GHOST_NET_PREFIX}/::pio_0_external_connection`,
    ]);
  });

  it('adds a removed port with the wire to its block', () => {
    const [base, current] = [read('nios_base.qsys'), read('nios_current.qsys')];
    const union = additions(base, current);
    expect(union.boundaryPins.map(({ pin }) => pin.name)).toEqual(['pio_0_external_connection']);
    expect(ends(union)).toContainEqual([
      '(port):pio_0_external_connection',
      '/pio_0:external_connection',
    ]);
  });

  it('does not add a renamed or a moved block as a ghost', () => {
    for (const [baseFile, currentFile] of [
      ['zynq_gpio_rename_base.bd', 'zynq_gpio_rename_current.bd'],
      ['zynq_gpio_base.bd', 'zynq_gpio_move_current.bd'],
      ['nios_rename_base.qsys', 'nios_rename_current.qsys'],
    ]) {
      const [base, current] = [read(baseFile), read(currentFile)];
      expect(additions(base, current)).toEqual({
        instances: [],
        pins: [],
        boundaryPins: [],
        nets: [],
      });
    }
  });

  it('mirrors: what one direction adds, the other has as a block of its own', () => {
    const union = additions(zynq.current, zynq.base);
    expect(union.instances.map((i) => i.path)).toEqual(['/axis_data_fifo_0']);
    // The current side of the mirror has the removed port and block; the added ones are not ghosts.
    expect(union.boundaryPins).toEqual([]);
    const nios = [read('nios_current.qsys'), read('nios_base.qsys')];
    const niosUnion = additions(nios[0], nios[1]);
    expect(niosUnion.instances.map((i) => i.path)).toEqual(['/fifo_0']);
    expect(ends(niosUnion)).toEqual([
      ['/fifo_0:in', '/st_source_0:src'],
      ['/fifo_0:out', '/st_sink_0:sink'],
    ]);
    expect(niosUnion.pins).toEqual([]);
  });

  it('makes a removed hierarchy one ghost block, with the wire to its neighbour and without what was inside it', () => {
    const [base, current] = [systemBd(), systemBd(withoutGpioBlock)];
    expect(Object.keys(base.instances)).toContain('/gpio_block/axi_gpio_1');
    const union = additions(base, current);
    expect(union.instances.map((i) => i.path)).toEqual(['/gpio_block']);
    expect(union.instances[0].kind).toBe('hier');
    // The wire of the hierarchy to the interconnect, and the interconnect port it was on.
    expect(ends(union)).toEqual([['/axi_periph:M01_AXI', '/gpio_block:S_AXI']]);
    expect(union.pins.map(({ instance, pin }) => `${instance}:${pin.name}`)).toEqual([
      '/axi_periph:M01_AXI',
    ]);
    // Nothing of the inside, which has no level in the current graph.
    expect(union.nets.every((net) => net.level === '/')).toBe(true);
  });

  it('adds a block removed inside a hierarchy that stays, on that level', () => {
    const [base, current] = [systemBd(), systemBd(withoutNestedSlave)];
    const union = additions(base, current);
    expect(union.instances.map((i) => [i.path, i.parent])).toEqual([
      ['/gpio_block/axi_gpio_1', '/gpio_block'],
    ]);
  });

  it('takes the base with the renames applied from the caller, which gives the same result', () => {
    const diff = diffSystemGraphs(zynq.base, zynq.current);
    expect(unionAdditions(zynq.base, zynq.current, diff, findingsBase(zynq.base, diff))).toEqual(
      unionAdditions(zynq.base, zynq.current, diff)
    );
  });

  it('is plain JSON', () => {
    const union = additions(zynq.base, zynq.current);
    expect(JSON.parse(JSON.stringify(union))).toEqual(union);
  });
});
