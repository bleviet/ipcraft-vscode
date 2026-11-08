#!/usr/bin/env node
/**
 * Generates large synthetic system designs for the system viewer: a Vivado
 * block design (`write_bd_tcl` style) and a Platform Designer `.qsys`, both
 * a multi-channel DSP SoC whose size scales with the channel count. They are
 * for checking layout performance and UI/UX on big designs; they are not
 * exported from real projects and are not meant to be synthesized.
 *
 * Each channel: a DMA, an ADC and a DAC stream through clock domain crossings,
 * a FIR filter, a gain stage, a status GPIO and two interrupts, on three clock
 * domains: control (100 MHz) and DSP (250 MHz) from one clock generator, and
 * the converter I/O clock (61.44 MHz) from an external port. The block design
 * puts a channel in a hierarchy (`ch<i>`, with a nested `dsp` hierarchy) or,
 * with `--flat`, every cell on the root level. `.qsys` systems are always flat.
 * Every eighth channel is clocked wrong on purpose: in the block design its ADC
 * stream reaches the DSP clock unsynchronized (a flagged CDC); Platform
 * Designer inserts its own adapters, so the `.qsys` lists it as handled.
 *
 * Usage:
 *   node scripts/generate-system-samples.js                 # the standard set
 *   node scripts/generate-system-samples.js --channels 200 [--flat] [--out <dir>]
 *
 * The standard set is written to src/test/fixtures/system-design/generated/.
 * Output is deterministic, so regenerating it leaves the files unchanged.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.resolve(__dirname, '../src/test/fixtures/system-design/generated');
const STANDARD_SET = [
  { kind: 'bd', channels: 8, flat: false },
  { kind: 'bd', channels: 64, flat: false },
  { kind: 'bd', channels: 64, flat: true },
  { kind: 'qsys', channels: 8 },
  { kind: 'qsys', channels: 64 },
];

const VLNV = {
  ps: 'xilinx.com:ip:zynq_ultra_ps_e:3.5',
  clkWiz: 'xilinx.com:ip:clk_wiz:6.0',
  reset: 'xilinx.com:ip:proc_sys_reset:5.0',
  smartconnect: 'xilinx.com:ip:smartconnect:1.0',
  concat: 'xilinx.com:ip:xlconcat:2.1',
  dma: 'xilinx.com:ip:axi_dma:7.1',
  gpio: 'xilinx.com:ip:axi_gpio:2.0',
  uart: 'xilinx.com:ip:axi_uartlite:2.0',
  iic: 'xilinx.com:ip:axi_iic:2.1',
  timer: 'xilinx.com:ip:axi_timer:2.0',
  cdc: 'xilinx.com:ip:axis_clock_converter:1.1',
  fifo: 'xilinx.com:ip:axis_data_fifo:2.0',
  fir: 'xilinx.com:ip:fir_compiler:7.2',
};
const INTF = {
  aximm: 'xilinx.com:interface:aximm_rtl:1.0',
  axis: 'xilinx.com:interface:axis_rtl:1.0',
  gpio: 'xilinx.com:interface:gpio_rtl:1.0',
  uart: 'xilinx.com:interface:uart_rtl:1.0',
  iic: 'xilinx.com:interface:iic_rtl:1.0',
};
const CHANNELS_PER_CTRL_GROUP = 16;
const CHANNELS_PER_MEM_GROUP = 8;
const IRQS_PER_CONCAT = 32;
const HP_PORTS = 4;
/** Every eighth channel carries a deliberate clock domain crossing bug. */
const MISCLOCKED_EVERY = 8;

const pad2 = (n) => String(n).padStart(2, '0');
const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
const chunk = (length, size) => Math.ceil(length / size);

// ---------------------------------------------------------------------------
// Block design model: levels of cells, pins and nets. `@name` in a net names a
// boundary pin of the net's level (an external port at the root).

function bdLevel(pins = []) {
  return { cells: [], pins, nets: [] };
}

function cell(level, name, spec, props = {}) {
  level.cells.push({ name, ...spec, props });
}

function net(level, name, intf, endpoints) {
  level.nets.push({ name, intf, endpoints });
}

/**
 * Cells and nets of a channel inside its own level; its boundary pins are `@`.
 * A `misclocked` channel clocks the ADC converter's output on the I/O clock,
 * so its stream into the DSP hierarchy is a clock domain crossing to flag.
 */
function channelLevels(misclocked) {
  const ch = bdLevel([
    { name: 'S_AXI_LITE', intf: 'Slave', vlnv: INTF.aximm },
    { name: 'M_AXI_MM2S', intf: 'Master', vlnv: INTF.aximm },
    { name: 'M_AXI_S2MM', intf: 'Master', vlnv: INTF.aximm },
    { name: 'S_AXIS_ADC', intf: 'Slave', vlnv: INTF.axis },
    { name: 'M_AXIS_DAC', intf: 'Master', vlnv: INTF.axis },
    { name: 'ctrl_clk', dir: 'I', type: 'clk' },
    { name: 'dsp_clk', dir: 'I', type: 'clk' },
    { name: 'io_clk', dir: 'I', type: 'clk' },
    { name: 'ctrl_resetn', dir: 'I', type: 'rst' },
    { name: 'dsp_resetn', dir: 'I', type: 'rst' },
    { name: 'io_resetn', dir: 'I', type: 'rst' },
    { name: 'mm2s_irq', dir: 'O', type: 'intr' },
    { name: 's2mm_irq', dir: 'O', type: 'intr' },
  ]);
  cell(ch, 'ctrl_sc', { vlnv: VLNV.smartconnect }, { NUM_SI: 1, NUM_MI: 2 });
  cell(ch, 'axi_dma', { vlnv: VLNV.dma }, { c_include_sg: 0, c_sg_length_width: 23 });
  cell(ch, 'status_gpio', { vlnv: VLNV.gpio }, { C_ALL_INPUTS: 1, C_GPIO_WIDTH: 8 });
  cell(ch, 'adc_cdc', { vlnv: VLNV.cdc }, { TDATA_NUM_BYTES: 2 });
  cell(ch, 'dac_cdc', { vlnv: VLNV.cdc }, { TDATA_NUM_BYTES: 2 });
  cell(ch, 'dsp', { hier: true });
  net(ch, 'S_AXI_LITE_1', true, ['@S_AXI_LITE', 'ctrl_sc/S00_AXI']);
  net(ch, 'ctrl_sc_M00_AXI', true, ['ctrl_sc/M00_AXI', 'axi_dma/S_AXI_LITE']);
  net(ch, 'ctrl_sc_M01_AXI', true, ['ctrl_sc/M01_AXI', 'status_gpio/S_AXI']);
  net(ch, 'axi_dma_M_AXI_MM2S', true, ['axi_dma/M_AXI_MM2S', '@M_AXI_MM2S']);
  net(ch, 'axi_dma_M_AXI_S2MM', true, ['axi_dma/M_AXI_S2MM', '@M_AXI_S2MM']);
  net(ch, 'S_AXIS_ADC_1', true, ['@S_AXIS_ADC', 'adc_cdc/S_AXIS']);
  net(ch, 'adc_cdc_M_AXIS', true, ['adc_cdc/M_AXIS', 'dsp/S_AXIS']);
  net(ch, 'dsp_M_AXIS', true, ['dsp/M_AXIS', 'axi_dma/S_AXIS_S2MM']);
  net(ch, 'axi_dma_M_AXIS_MM2S', true, ['axi_dma/M_AXIS_MM2S', 'dac_cdc/S_AXIS']);
  net(ch, 'dac_cdc_M_AXIS', true, ['dac_cdc/M_AXIS', '@M_AXIS_DAC']);
  net(ch, 'ctrl_clk_1', false, [
    '@ctrl_clk',
    'ctrl_sc/aclk',
    'axi_dma/s_axi_lite_aclk',
    'status_gpio/s_axi_aclk',
  ]);
  net(ch, 'dsp_clk_1', false, [
    '@dsp_clk',
    'axi_dma/m_axi_mm2s_aclk',
    'axi_dma/m_axi_s2mm_aclk',
    ...(misclocked ? [] : ['adc_cdc/m_axis_aclk']),
    'dac_cdc/s_axis_aclk',
    'dsp/aclk',
  ]);
  net(ch, 'io_clk_1', false, [
    '@io_clk',
    'adc_cdc/s_axis_aclk',
    ...(misclocked ? ['adc_cdc/m_axis_aclk'] : []),
    'dac_cdc/m_axis_aclk',
  ]);
  net(ch, 'ctrl_resetn_1', false, [
    '@ctrl_resetn',
    'ctrl_sc/aresetn',
    'axi_dma/axi_resetn',
    'status_gpio/s_axi_aresetn',
  ]);
  net(ch, 'dsp_resetn_1', false, [
    '@dsp_resetn',
    'adc_cdc/m_axis_aresetn',
    'dac_cdc/s_axis_aresetn',
    'dsp/aresetn',
  ]);
  net(ch, 'io_resetn_1', false, ['@io_resetn', 'adc_cdc/s_axis_aresetn', 'dac_cdc/m_axis_aresetn']);
  net(ch, 'axi_dma_mm2s_introut', false, ['axi_dma/mm2s_introut', '@mm2s_irq']);
  net(ch, 'axi_dma_s2mm_introut', false, ['axi_dma/s2mm_introut', '@s2mm_irq']);

  const dsp = bdLevel([
    { name: 'S_AXIS', intf: 'Slave', vlnv: INTF.axis },
    { name: 'M_AXIS', intf: 'Master', vlnv: INTF.axis },
    { name: 'aclk', dir: 'I', type: 'clk' },
    { name: 'aresetn', dir: 'I', type: 'rst' },
  ]);
  cell(dsp, 'in_fifo', { vlnv: VLNV.fifo }, { FIFO_DEPTH: 1024 });
  cell(dsp, 'fir', { vlnv: VLNV.fir }, { Data_Width: 16, Coefficient_Width: 16 });
  cell(dsp, 'gain', { module: 'gain_stage' }, { GAIN_WIDTH: 12 });
  net(dsp, 'S_AXIS_1', true, ['@S_AXIS', 'in_fifo/S_AXIS']);
  net(dsp, 'in_fifo_M_AXIS', true, ['in_fifo/M_AXIS', 'fir/S_AXIS_DATA']);
  net(dsp, 'fir_M_AXIS_DATA', true, ['fir/M_AXIS_DATA', 'gain/s_axis']);
  net(dsp, 'gain_m_axis', true, ['gain/m_axis', '@M_AXIS']);
  net(dsp, 'aclk_1', false, ['@aclk', 'in_fifo/s_axis_aclk', 'fir/aclk', 'gain/clk']);
  net(dsp, 'aresetn_1', false, ['@aresetn', 'in_fifo/s_axis_aresetn', 'gain/rst_n']);
  return { ch, dsp };
}

/** The whole design as levels keyed by path; channel levels are `/ch<i>` and `/ch<i>/dsp`. */
function bdDesign(channels) {
  const root = bdLevel();
  const levels = { '/': root };
  const ports = [];
  const addresses = [];
  const ctrlGroups = chunk(channels, CHANNELS_PER_CTRL_GROUP);
  const memGroups = chunk(channels, CHANNELS_PER_MEM_GROUP);
  const hpUsed = Math.min(HP_PORTS, memGroups);
  const concats = chunk(channels * 2 + 2, IRQS_PER_CONCAT);

  cell(
    root,
    'zynq_ultra_ps_e_0',
    { vlnv: VLNV.ps },
    {
      PSU__CRL_APB__PL0_REF_CTRL__FREQMHZ: 100,
      PSU__USE__M_AXI_GP0: 1,
      PSU__USE__IRQ0: 1,
      ...Object.fromEntries(
        Array.from({ length: hpUsed }, (_, k) => [`PSU__USE__S_AXI_GP${k + 2}`, 1])
      ),
    }
  );
  cell(
    root,
    'clk_wiz_0',
    { vlnv: VLNV.clkWiz },
    {
      CLKOUT1_REQUESTED_OUT_FREQ: 100,
      CLKOUT2_USED: 'true',
      CLKOUT2_REQUESTED_OUT_FREQ: 250,
      NUM_OUT_CLKS: 2,
    }
  );
  for (const domain of ['ctrl_100M', 'dsp_250M', 'io_61M']) {
    cell(root, `rst_${domain}`, { vlnv: VLNV.reset });
  }
  cell(root, 'ctrl_sc_root', { vlnv: VLNV.smartconnect }, { NUM_SI: 1, NUM_MI: ctrlGroups + 4 });
  for (let g = 0; g < ctrlGroups; g++) {
    const size = Math.min(CHANNELS_PER_CTRL_GROUP, channels - g * CHANNELS_PER_CTRL_GROUP);
    cell(root, `ctrl_sc_${g}`, { vlnv: VLNV.smartconnect }, { NUM_SI: 1, NUM_MI: size });
  }
  for (let g = 0; g < memGroups; g++) {
    const size = Math.min(CHANNELS_PER_MEM_GROUP, channels - g * CHANNELS_PER_MEM_GROUP);
    cell(root, `mem_sc_${g}`, { vlnv: VLNV.smartconnect }, { NUM_SI: size * 2, NUM_MI: 1 });
  }
  for (let k = 0; k < hpUsed; k++) {
    const inputs = chunk(memGroups - k, HP_PORTS);
    cell(root, `mem_sc_hp${k}`, { vlnv: VLNV.smartconnect }, { NUM_SI: inputs, NUM_MI: 1 });
  }
  for (let j = 0; j < concats; j++) {
    cell(root, `irq_concat_${j}`, { vlnv: VLNV.concat }, { NUM_PORTS: IRQS_PER_CONCAT });
  }
  cell(root, 'irq_concat_top', { vlnv: VLNV.concat }, { NUM_PORTS: concats });
  cell(root, 'led_gpio', { vlnv: VLNV.gpio }, { C_ALL_OUTPUTS: 1, C_GPIO_WIDTH: 8 });
  cell(root, 'uart', { vlnv: VLNV.uart }, { C_BAUDRATE: 115200 });
  cell(root, 'iic', { vlnv: VLNV.iic });
  cell(root, 'timer', { vlnv: VLNV.timer });

  ports.push(
    { name: 'adc_clk', dir: 'I', type: 'clk', freqHz: 61440000 },
    { name: 'leds_8bits', intf: 'Master', vlnv: INTF.gpio },
    { name: 'uart', intf: 'Master', vlnv: INTF.uart },
    { name: 'iic', intf: 'Master', vlnv: INTF.iic }
  );

  const ps = 'zynq_ultra_ps_e_0';
  const clk = { ctrl: 'clk_wiz_0/clk_out1', dsp: 'clk_wiz_0/clk_out2', io: '@adc_clk' };
  const clkNet = { ctrl: 'clk_wiz_0_clk_out1', dsp: 'clk_wiz_0_clk_out2', io: 'adc_clk_1' };
  const clkLoads = { ctrl: [], dsp: [], io: [] };
  const rstLoads = { ctrl: [], dsp: [], io: [] };
  const irqInputs = [];

  net(root, 'ps_M_AXI_HPM0_FPD', true, [`${ps}/M_AXI_HPM0_FPD`, 'ctrl_sc_root/S00_AXI']);
  for (let g = 0; g < ctrlGroups; g++) {
    net(root, `ctrl_sc_root_M${pad2(g)}_AXI`, true, [
      `ctrl_sc_root/M${pad2(g)}_AXI`,
      `ctrl_sc_${g}/S00_AXI`,
    ]);
    clkLoads.ctrl.push(`ctrl_sc_${g}/aclk`);
    rstLoads.ctrl.push(`ctrl_sc_${g}/aresetn`);
  }
  ['led_gpio', 'uart', 'iic', 'timer'].forEach((peripheral, n) => {
    const mi = `M${pad2(ctrlGroups + n)}_AXI`;
    net(root, `ctrl_sc_root_${mi}`, true, [`ctrl_sc_root/${mi}`, `${peripheral}/S_AXI`]);
    clkLoads.ctrl.push(`${peripheral}/s_axi_aclk`);
    rstLoads.ctrl.push(`${peripheral}/s_axi_aresetn`);
    addresses.push({ slave: `${peripheral}/S_AXI/Reg`, offset: 0x80000000 + n * 0x10000 });
  });
  net(root, 'led_gpio_GPIO', true, ['led_gpio/GPIO', '@leds_8bits']);
  net(root, 'uart_UART', true, ['uart/UART', '@uart']);
  net(root, 'iic_IIC', true, ['iic/IIC', '@iic']);
  irqInputs.push('uart/interrupt', 'timer/interrupt');

  for (let g = 0; g < memGroups; g++) {
    const k = g % HP_PORTS;
    const si = Math.floor(g / HP_PORTS);
    net(root, `mem_sc_${g}_M00_AXI`, true, [
      `mem_sc_${g}/M00_AXI`,
      `mem_sc_hp${k}/S${pad2(si)}_AXI`,
    ]);
    clkLoads.dsp.push(`mem_sc_${g}/aclk`);
    rstLoads.dsp.push(`mem_sc_${g}/aresetn`);
  }
  for (let k = 0; k < hpUsed; k++) {
    net(root, `mem_sc_hp${k}_M00_AXI`, true, [`mem_sc_hp${k}/M00_AXI`, `${ps}/S_AXI_HP${k}_FPD`]);
    clkLoads.dsp.push(`mem_sc_hp${k}/aclk`, `${ps}/saxihp${k}_fpd_aclk`);
    rstLoads.dsp.push(`mem_sc_hp${k}/aresetn`);
  }

  for (let i = 0; i < channels; i++) {
    const { ch, dsp } = channelLevels(i % MISCLOCKED_EVERY === MISCLOCKED_EVERY - 1);
    const name = `ch${i}`;
    levels[`/${name}`] = ch;
    levels[`/${name}/dsp`] = dsp;
    cell(root, name, { hier: true });
    const g = Math.floor(i / CHANNELS_PER_CTRL_GROUP);
    const mi = pad2(i % CHANNELS_PER_CTRL_GROUP);
    const m = Math.floor(i / CHANNELS_PER_MEM_GROUP);
    const si = (i % CHANNELS_PER_MEM_GROUP) * 2;
    net(root, `ctrl_sc_${g}_M${mi}_AXI`, true, [`ctrl_sc_${g}/M${mi}_AXI`, `${name}/S_AXI_LITE`]);
    net(root, `${name}_M_AXI_MM2S`, true, [`${name}/M_AXI_MM2S`, `mem_sc_${m}/S${pad2(si)}_AXI`]);
    net(root, `${name}_M_AXI_S2MM`, true, [
      `${name}/M_AXI_S2MM`,
      `mem_sc_${m}/S${pad2(si + 1)}_AXI`,
    ]);
    ports.push(
      { name: `adc${i}`, intf: 'Slave', vlnv: INTF.axis },
      { name: `dac${i}`, intf: 'Master', vlnv: INTF.axis }
    );
    net(root, `adc${i}_1`, true, [`@adc${i}`, `${name}/S_AXIS_ADC`]);
    net(root, `${name}_M_AXIS_DAC`, true, [`${name}/M_AXIS_DAC`, `@dac${i}`]);
    for (const domain of ['ctrl', 'dsp', 'io']) {
      clkLoads[domain].push(`${name}/${domain}_clk`);
      rstLoads[domain].push(`${name}/${domain}_resetn`);
    }
    irqInputs.push(`${name}/mm2s_irq`, `${name}/s2mm_irq`);
    addresses.push({ slave: `${name}/axi_dma/S_AXI_LITE/Reg`, offset: 0xa0000000 + i * 0x20000 });
    addresses.push({
      slave: `${name}/status_gpio/S_AXI/Reg`,
      offset: 0xa0010000 + i * 0x20000,
    });
  }

  irqInputs.forEach((source, n) => {
    const j = Math.floor(n / IRQS_PER_CONCAT);
    const input = `irq_concat_${j}/In${n % IRQS_PER_CONCAT}`;
    net(root, source.replace('/', '_'), false, [source, input]);
  });
  for (let j = 0; j < concats; j++) {
    net(root, `irq_concat_${j}_dout`, false, [`irq_concat_${j}/dout`, `irq_concat_top/In${j}`]);
  }
  net(root, 'irq_concat_top_dout', false, ['irq_concat_top/dout', `${ps}/pl_ps_irq0`]);

  net(root, 'ps_pl_clk0', false, [`${ps}/pl_clk0`, 'clk_wiz_0/clk_in1']);
  net(root, 'ps_pl_resetn0', false, [
    `${ps}/pl_resetn0`,
    'clk_wiz_0/resetn',
    'rst_ctrl_100M/ext_reset_in',
    'rst_dsp_250M/ext_reset_in',
    'rst_io_61M/ext_reset_in',
  ]);
  net(root, 'clk_wiz_0_locked', false, [
    'clk_wiz_0/locked',
    'rst_ctrl_100M/dcm_locked',
    'rst_dsp_250M/dcm_locked',
  ]);
  const resetBlock = { ctrl: 'rst_ctrl_100M', dsp: 'rst_dsp_250M', io: 'rst_io_61M' };
  clkLoads.ctrl.unshift(`${ps}/maxihpm0_fpd_aclk`, 'ctrl_sc_root/aclk');
  rstLoads.ctrl.unshift('ctrl_sc_root/aresetn');
  for (const domain of ['ctrl', 'dsp', 'io']) {
    net(root, clkNet[domain], false, [
      clk[domain],
      `${resetBlock[domain]}/slowest_sync_clk`,
      ...clkLoads[domain],
    ]);
    net(root, `${resetBlock[domain]}_peripheral_aresetn`, false, [
      `${resetBlock[domain]}/peripheral_aresetn`,
      ...rstLoads[domain],
    ]);
  }
  return { levels, ports, addresses };
}

/** Moves every channel cell to the root as `ch<i>_<cell>` and joins the nets through removed hierarchy pins. */
function flatten(design) {
  const root = bdLevel();
  const nets = [];
  const walk = (levelPath, prefix) => {
    const level = design.levels[levelPath];
    for (const c of level.cells) {
      if (c.hier) {
        walk(`${levelPath === '/' ? '' : levelPath}/${c.name}`, `${prefix}${c.name}_`);
      } else {
        root.cells.push({ ...c, name: `${prefix}${c.name}` });
      }
    }
    for (const n of level.nets) {
      nets.push({
        name: `${prefix}${n.name}`,
        intf: n.intf,
        // A boundary pin of a channel level is the hierarchy pin `<path>/<pin>` one level up.
        endpoints: n.endpoints.map((ep) =>
          ep.startsWith('@')
            ? levelPath === '/'
              ? ep
              : `${prefix.slice(0, -1)}#${ep.slice(1)}`
            : `${prefix}${ep}`
        ),
      });
    }
  };
  walk('/', '');
  // `a_b/pin` (a hierarchy pin seen from above) and `a_b#pin` (seen from inside) are the same joint.
  const joint = (ep) => (ep.includes('#') ? ep.replace('#', '/') : ep);
  const isHierPin = new Set(
    nets.flatMap((n) => n.endpoints.filter((ep) => ep.includes('#')).map(joint))
  );
  const parent = nets.map((_, n) => n);
  const find = (n) => (parent[n] === n ? n : (parent[n] = find(parent[n])));
  const owner = new Map();
  nets.forEach((n, index) => {
    for (const ep of n.endpoints.map(joint).filter((key) => isHierPin.has(key))) {
      if (owner.has(ep)) {
        parent[find(index)] = find(owner.get(ep));
      } else {
        owner.set(ep, index);
      }
    }
  });
  const merged = new Map();
  nets.forEach((n, index) => {
    const head = find(index);
    const entry = merged.get(head) ?? { name: nets[head].name, intf: n.intf, endpoints: [] };
    entry.endpoints.push(...n.endpoints.map(joint).filter((ep) => !isHierPin.has(ep)));
    merged.set(head, entry);
  });
  root.nets = [...merged.values()].filter((n) => n.endpoints.length > 1);
  const addresses = design.addresses.map((a) => ({
    ...a,
    slave: a.slave.replace(/^(ch\d+)\/(\w+)\//, '$1_$2/'),
  }));
  return { levels: { '/': root }, ports: design.ports, addresses };
}

// ---------------------------------------------------------------------------
// Block design Tcl writer

function pinRef(endpoint, intf) {
  const name = endpoint.startsWith('@') ? endpoint.slice(1) : endpoint;
  return `[get_bd_${intf ? 'intf_' : ''}pins ${name}]`;
}

function cellLines(c, indent) {
  const lines = [];
  if (c.hier) {
    return lines;
  }
  if (c.module) {
    lines.push(
      `${indent}set ${c.name} [ create_bd_cell -type module -reference ${c.module} ${c.name} ]`
    );
  } else {
    lines.push(`${indent}set ${c.name} [ create_bd_cell -type ip -vlnv ${c.vlnv} ${c.name} ]`);
  }
  const props = Object.entries(c.props);
  if (props.length > 0) {
    lines.push(`${indent}set_property -dict [list \\`);
    for (const [key, value] of props) {
      lines.push(`${indent}  CONFIG.${key} {${value}} \\`);
    }
    lines.push(`${indent}] $${c.name}`, '');
  }
  return lines;
}

function netLines(level, indent, boundary) {
  const lines = [];
  const sorted = [...level.nets].sort((a, b) => Number(b.intf) - Number(a.intf));
  for (const n of sorted) {
    const refs = n.endpoints.map((ep) =>
      ep.startsWith('@') && boundary === 'ports'
        ? `[get_bd_${n.intf ? 'intf_' : ''}ports ${ep.slice(1)}]`
        : pinRef(ep, n.intf)
    );
    const command = n.intf ? 'connect_bd_intf_net -intf_net' : 'connect_bd_net -net';
    lines.push(`${indent}${command} ${n.name} ${refs.join(` \\\n${indent}  `)}`);
  }
  return lines;
}

function pinLines(pins, indent, port) {
  return pins.map((p) => {
    const noun = port ? 'port' : 'pin';
    return p.intf
      ? `${indent}create_bd_intf_${noun} -mode ${p.intf} -vlnv ${p.vlnv} ${p.name}`
      : `${indent}create_bd_${noun} -dir ${p.dir} -type ${p.type}${p.freqHz ? ` -freq_hz ${p.freqHz}` : ''} ${p.name}`;
  });
}

function hierProc(design, levelPath) {
  const level = design.levels[levelPath];
  const procName = `create_hier_cell_${levelPath.slice(1).replace(/\//g, '_')}`;
  const lines = [
    `# Hierarchical cell: ${levelPath.split('/').pop()}`,
    `proc ${procName} { parentCell nameHier } {`,
    '  set parentObj [get_bd_cells $parentCell]',
    '  set oldCurInst [current_bd_instance .]',
    '  current_bd_instance $parentObj',
    '  set hier_obj [create_bd_cell -type hier $nameHier]',
    '  current_bd_instance $hier_obj',
    '',
    ...pinLines(level.pins, '  ', false),
    '',
  ];
  for (const c of level.cells) {
    if (c.hier) {
      lines.push(`  ${hierProcName(levelPath, c.name)} $hier_obj ${c.name}`);
    } else {
      lines.push(...cellLines(c, '  '));
    }
  }
  lines.push('', ...netLines(level, '  ', 'pins'), '', '  current_bd_instance $oldCurInst', '}');
  return lines;
}

const hierProcName = (parentPath, name) =>
  `create_hier_cell_${`${parentPath}/${name}`.replace(/^\//, '').replace(/\//g, '_')}`;

function writeBdTcl(design, designName) {
  const lines = [
    '################################################################',
    `# This is a generated script based on design: ${designName}`,
    '################################################################',
    '',
    '# Synthetic sample for IPCraft system viewer performance and UI/UX checks.',
    '# Generated by scripts/generate-system-samples.js; not exported from Vivado.',
    '',
    'set scripts_vivado_version 2024.2',
    '',
    'variable design_name',
    `set design_name ${designName}`,
    'create_bd_design $design_name',
    'current_bd_design $design_name',
    '',
  ];
  // Children before parents, as write_bd_tcl orders its procs.
  const hierPaths = Object.keys(design.levels)
    .filter((p) => p !== '/')
    .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b));
  for (const levelPath of hierPaths) {
    lines.push(...hierProc(design, levelPath), '');
  }
  const root = design.levels['/'];
  lines.push(
    '# Procedure to create entire design',
    'proc create_root_design { parentCell } {',
    '  variable design_name',
    '  if { $parentCell eq "" } {',
    '     set parentCell [get_bd_cells /]',
    '  }',
    '  set parentObj [get_bd_cells $parentCell]',
    '  set oldCurInst [current_bd_instance .]',
    '  current_bd_instance $parentObj',
    '',
    ...pinLines(design.ports, '  ', true),
    ''
  );
  for (const c of root.cells) {
    if (c.hier) {
      lines.push(`  ${hierProcName('', c.name)} [current_bd_instance .] ${c.name}`);
    } else {
      lines.push(...cellLines(c, '  '));
    }
  }
  lines.push('', ...netLines(root, '  ', 'ports'), '');
  for (const a of design.addresses) {
    lines.push(
      `  assign_bd_address -offset ${hex(a.offset)} -range 0x00010000 -target_address_space [get_bd_addr_spaces zynq_ultra_ps_e_0/Data] [get_bd_addr_segs ${a.slave}] -force`
    );
  }
  lines.push(
    '',
    '  current_bd_instance $oldCurInst',
    '  validate_bd_design',
    '  save_bd_design',
    '}',
    '# End of create_root_design()',
    '',
    'create_root_design ""',
    ''
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Platform Designer .qsys writer (flat: Platform Designer has no hierarchy here)

function qsysDesign(channels) {
  const modules = [];
  const connections = [];
  const interfaces = [];
  const mod = (name, kind, version, params = {}) => modules.push({ name, kind, version, params });
  const conn = (kind, start, end, params = {}) => connections.push({ kind, start, end, params });
  const bridges = chunk(channels, CHANNELS_PER_CTRL_GROUP);
  const domains = { ctrl: 'iopll_0.outclk0', dsp: 'iopll_0.outclk1', io: 'iopll_0.outclk2' };
  const resets = { ctrl: 'rst_ctrl.out_reset', dsp: 'rst_dsp.out_reset', io: 'rst_io.out_reset' };
  const clocked = (domain, clockPin, resetPin) => {
    conn('clock', domains[domain], clockPin);
    conn('reset', resets[domain], resetPin);
  };

  mod('clk_0', 'clock_source', '23.1', { clockFrequency: 50000000, clockFrequencyKnown: true });
  mod('iopll_0', 'altera_iopll', '23.1', {
    gui_number_of_clocks: 3,
    gui_output_clock_frequency0: 100.0,
    gui_output_clock_frequency1: 250.0,
    gui_output_clock_frequency2: 50.0,
  });
  for (const domain of ['ctrl', 'dsp', 'io']) {
    mod(`rst_${domain}`, 'altera_reset_bridge', '23.1', { SYNCHRONOUS_EDGES: 'deassert' });
  }
  mod('cpu', 'intel_niosv_g', '23.1', { resetSlave: 'onchip_mem.s1' });
  mod('onchip_mem', 'altera_avalon_onchip_memory2', '23.1', { memorySize: 262144 });
  mod('jtag_uart', 'altera_avalon_jtag_uart', '23.1');
  mod('sysid', 'altera_avalon_sysid_qsys', '23.1', { id: 0x1234 });
  mod('led_pio', 'altera_avalon_pio', '23.1', { direction: 'Output', width: 8 });
  mod('ddr_bridge', 'altera_avalon_mm_clock_crossing_bridge', '23.1', { DATA_WIDTH: 128 });
  for (let b = 0; b < bridges; b++) {
    mod(`ctrl_bridge_${b}`, 'altera_avalon_mm_bridge', '23.1', { DATA_WIDTH: 32 });
  }

  conn('clock', 'clk_0.clk', 'iopll_0.refclk');
  conn('reset', 'clk_0.clk_reset', 'iopll_0.reset');
  for (const domain of ['ctrl', 'dsp', 'io']) {
    conn('clock', domains[domain], `rst_${domain}.clk`);
    conn('reset', 'clk_0.clk_reset', `rst_${domain}.in_reset`);
  }
  for (const name of ['cpu', 'onchip_mem', 'jtag_uart', 'sysid', 'led_pio']) {
    const [clockPin, resetPin] = name === 'onchip_mem' ? ['clk1', 'reset1'] : ['clk', 'reset'];
    clocked('ctrl', `${name}.${clockPin}`, `${name}.${resetPin}`);
  }
  clocked('ctrl', 'ddr_bridge.s0_clk', 'ddr_bridge.s0_reset');
  clocked('dsp', 'ddr_bridge.m0_clk', 'ddr_bridge.m0_reset');
  conn('avalon', 'cpu.instruction_manager', 'onchip_mem.s1', { baseAddress: hex(0) });
  conn('avalon', 'cpu.data_manager', 'onchip_mem.s1', { baseAddress: hex(0) });
  conn('avalon', 'cpu.data_manager', 'jtag_uart.avalon_jtag_slave', { baseAddress: hex(0x40000) });
  conn('avalon', 'cpu.data_manager', 'sysid.control_slave', { baseAddress: hex(0x40008) });
  conn('avalon', 'cpu.data_manager', 'led_pio.s1', { baseAddress: hex(0x40010) });
  conn('avalon', 'cpu.data_manager', 'ddr_bridge.s0', { baseAddress: hex(0x80000000) });
  conn('interrupt', 'cpu.platform_irq_rx', 'jtag_uart.irq', { irqNumber: 0 });
  for (let b = 0; b < bridges; b++) {
    clocked('ctrl', `ctrl_bridge_${b}.clk`, `ctrl_bridge_${b}.reset`);
    conn('avalon', 'cpu.data_manager', `ctrl_bridge_${b}.s0`, {
      baseAddress: hex(0x10000000 + b * 0x1000000),
    });
  }
  interfaces.push(
    { name: 'clk', internal: 'clk_0.clk_in', type: 'clock', dir: 'end' },
    { name: 'reset', internal: 'clk_0.clk_in_reset', type: 'reset', dir: 'end' },
    { name: 'leds', internal: 'led_pio.external_connection', type: 'conduit', dir: 'end' },
    { name: 'ddr', internal: 'ddr_bridge.m0', type: 'avalon', dir: 'start' }
  );

  for (let i = 0; i < channels; i++) {
    const c = `ch${i}`;
    const bridge = `ctrl_bridge_${Math.floor(i / CHANNELS_PER_CTRL_GROUP)}.m0`;
    const base = (i % CHANNELS_PER_CTRL_GROUP) * 0x10000;
    mod(`${c}_dma`, 'altera_msgdma', '23.1', { MODE: 0, DATA_WIDTH: 32 });
    mod(`${c}_adc_fifo`, 'altera_avalon_dc_fifo', '23.1', { FIFO_DEPTH: 512 });
    mod(`${c}_dac_fifo`, 'altera_avalon_dc_fifo', '23.1', { FIFO_DEPTH: 512 });
    mod(`${c}_fir`, 'altera_fir_compiler_ii', '23.1', { inputBitWidth: 16 });
    mod(`${c}_gain`, 'gain_stage', '1.0', { GAIN_WIDTH: 12 });
    mod(`${c}_status`, 'altera_avalon_pio', '23.1', { direction: 'Input', width: 8 });

    conn('avalon', bridge, `${c}_dma.csr`, { baseAddress: hex(base) });
    conn('avalon', bridge, `${c}_dma.descriptor_slave`, { baseAddress: hex(base + 0x100) });
    conn('avalon', bridge, `${c}_gain.csr`, { baseAddress: hex(base + 0x200) });
    conn('avalon', bridge, `${c}_status.s1`, { baseAddress: hex(base + 0x300) });
    conn('avalon', `${c}_dma.mm_read`, 'ddr_bridge.s0', { baseAddress: hex(0) });
    conn('avalon', `${c}_dma.mm_write`, 'ddr_bridge.s0', { baseAddress: hex(0) });
    conn('avalon_streaming', `${c}_adc_fifo.out`, `${c}_fir.avalon_streaming_sink`);
    conn('avalon_streaming', `${c}_fir.avalon_streaming_source`, `${c}_gain.in`);
    conn('avalon_streaming', `${c}_gain.out`, `${c}_dma.st_sink`);
    conn('avalon_streaming', `${c}_dma.st_source`, `${c}_dac_fifo.in`);
    conn('interrupt', 'cpu.platform_irq_rx', `${c}_dma.csr_irq`, { irqNumber: (i % 31) + 1 });
    clocked('dsp', `${c}_dma.clock`, `${c}_dma.reset_n`);
    const misclocked = i % MISCLOCKED_EVERY === MISCLOCKED_EVERY - 1;
    clocked(misclocked ? 'io' : 'dsp', `${c}_fir.clk`, `${c}_fir.rst`);
    clocked('dsp', `${c}_gain.clock`, `${c}_gain.reset`);
    clocked('ctrl', `${c}_status.clk`, `${c}_status.reset`);
    clocked('io', `${c}_adc_fifo.in_clk`, `${c}_adc_fifo.in_clk_reset`);
    clocked('dsp', `${c}_adc_fifo.out_clk`, `${c}_adc_fifo.out_clk_reset`);
    clocked('dsp', `${c}_dac_fifo.in_clk`, `${c}_dac_fifo.in_clk_reset`);
    clocked('io', `${c}_dac_fifo.out_clk`, `${c}_dac_fifo.out_clk_reset`);
    interfaces.push(
      { name: `adc${i}`, internal: `${c}_adc_fifo.in`, type: 'avalon_streaming', dir: 'end' },
      { name: `dac${i}`, internal: `${c}_dac_fifo.out`, type: 'avalon_streaming', dir: 'start' },
      {
        name: `status${i}`,
        internal: `${c}_status.external_connection`,
        type: 'conduit',
        dir: 'end',
      }
    );
  }
  return { modules, connections, interfaces };
}

const xmlAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function paramLines(params, indent) {
  return Object.entries(params).map(
    ([key, value]) => `${indent}<parameter name="${key}" value="${xmlAttr(value)}" />`
  );
}

function writeQsys({ modules, connections, interfaces }) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Synthetic sample for IPCraft system viewer performance and UI/UX checks.',
    '     Generated by scripts/generate-system-samples.js; not exported from Platform Designer. -->',
    '<system name="$${FILENAME}">',
    ' <component name="$${FILENAME}" displayName="$${FILENAME}" version="1.0" description="" tags="INTERNAL_COMPONENT=true" categories="System" />',
    ' <parameter name="deviceFamily" value="Agilex 7" />',
  ];
  for (const i of interfaces) {
    lines.push(
      ` <interface name="${i.name}" internal="${i.internal}" type="${i.type}" dir="${i.dir}" />`
    );
  }
  for (const m of modules) {
    const params = paramLines(m.params, '  ');
    const open = ` <module name="${m.name}" kind="${m.kind}" version="${m.version}" enabled="1"`;
    lines.push(...(params.length > 0 ? [`${open}>`, ...params, ' </module>'] : [`${open} />`]));
  }
  for (const c of connections) {
    const params = paramLines(c.params, '  ');
    const open = ` <connection kind="${c.kind}" version="23.1" start="${c.start}" end="${c.end}"`;
    lines.push(...(params.length > 0 ? [`${open}>`, ...params, ' </connection>'] : [`${open} />`]));
  }
  lines.push('</system>', '');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------

function generate({ kind, channels, flat }, outDir) {
  const base = kind === 'bd' ? `vivado_dsp_soc${flat ? '_flat' : ''}` : 'qsys_dsp_soc';
  const name = `${base}_${channels}ch`;
  const fileName = kind === 'bd' ? `${name}.tcl` : `${name}.qsys`;
  let text;
  if (kind === 'bd') {
    const design = bdDesign(channels);
    text = writeBdTcl(flat ? flatten(design) : design, name);
  } else {
    text = writeQsys(qsysDesign(channels));
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, fileName), text);
  return path.join(outDir, fileName);
}

function main(argv) {
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const outDir = path.resolve(value('--out') ?? DEFAULT_OUT);
  const channels = value('--channels');
  const jobs = channels
    ? [
        { kind: 'bd', channels: Number(channels), flat: argv.includes('--flat') },
        { kind: 'qsys', channels: Number(channels) },
      ]
    : STANDARD_SET;
  if (channels !== undefined && !(Number(channels) >= 1)) {
    throw new Error(`--channels must be a positive number, got ${channels}`);
  }
  for (const job of jobs) {
    const file = generate(job, outDir);
    process.stdout.write(`${path.relative(process.cwd(), file)}\n`);
  }
}

main(process.argv.slice(2));
