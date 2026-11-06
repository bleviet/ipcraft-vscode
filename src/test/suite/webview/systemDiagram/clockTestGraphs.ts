import type { SystemGraph } from '../../../../domain/systemGraph';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { readQsys } from '../../../../parser/system/QsysReader';
import { graftSubsystem } from '../../../../services/systemDiagram/enrichment/graftSubsystem';

/** Two blocks on clocks from two clk_wiz outputs, joined by a stream and a reset. */
export function loadTwoClockGraph(): SystemGraph {
  return readBdTcl(
    [
      'create_bd_design "d"',
      'set a [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 a ]',
      'set b [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 b ]',
      'set ca [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 ca ]',
      'set cb [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 cb ]',
      'set rst [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 rst ]',
      'set_property CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {100} $ca',
      'set_property CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {50} $cb',
      'connect_bd_intf_net -intf_net n1 [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      'connect_bd_net -net clk_a [get_bd_pins ca/clk_out1] [get_bd_pins a/clk] [get_bd_pins rst/slowest_sync_clk]',
      'connect_bd_net -net clk_b [get_bd_pins cb/clk_out1] [get_bd_pins b/clk]',
      'connect_bd_net -net rst_n [get_bd_pins rst/peripheral_aresetn] [get_bd_pins a/rst_n] [get_bd_pins b/rst_n]',
    ].join('\n'),
    'two_clocks.tcl'
  );
}

const CLOCK_SOURCE = (name: string, hz: number, edges: string) =>
  ` <module name="${name}" kind="clock_source" version="18.1" enabled="1">
  <parameter name="clockFrequency" value="${hz}" />
  <parameter name="resetSynchronousEdges" value="${edges}" />
 </module>`;

/** Platform Designer: two clock sources, a master and a slave on different clocks, and a reset from the first. */
export function loadQsysTwoClockGraph(): SystemGraph {
  return readQsys(
    `<system name="s">
 <interface name="clk_in" internal="clk_a.clk_in" type="clock" dir="end" />
${CLOCK_SOURCE('clk_a', 100000000, 'DEASSERT')}
${CLOCK_SOURCE('clk_b', 50000000, 'NONE')}
 <module name="mst" kind="altera_avalon_pio" version="18.1" enabled="1" />
 <module name="slv" kind="altera_avalon_pio" version="18.1" enabled="1" />
 <connection kind="clock" version="18.1" start="clk_a.clk" end="mst.clk" />
 <connection kind="clock" version="18.1" start="clk_b.clk" end="slv.clk" />
 <connection kind="avalon" version="18.1" start="mst.m0" end="slv.s0" />
 <connection kind="reset" version="18.1" start="clk_a.clk_reset" end="slv.reset" />
</system>`,
    's.qsys'
  );
}

/** A reset generated inside a hierarchy on one clock and used at the root by a block on another. */
export function loadInnerResetGraph(): SystemGraph {
  return readBdTcl(
    [
      'proc create_hier_cell_h { parentCell nameHier } {',
      '  set parentObj [get_bd_cells $parentCell]',
      '  set oldCurInst [current_bd_instance .]',
      '  current_bd_instance $parentObj',
      '  set hier_obj [create_bd_cell -type hier $nameHier]',
      '  current_bd_instance $hier_obj',
      '  create_bd_pin -dir I -type clk clk',
      '  create_bd_pin -dir O -type rst rst_out',
      '  set r [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 r ]',
      '  set r2 [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 r2 ]',
      '  connect_bd_net -net clk_1 [get_bd_pins clk] [get_bd_pins r/slowest_sync_clk] [get_bd_pins r2/clk]',
      '  connect_bd_net -net r_out [get_bd_pins r/peripheral_aresetn] [get_bd_pins rst_out] [get_bd_pins r2/rst_n]',
      '  current_bd_instance $oldCurInst',
      '}',
      'proc create_root_design { parentCell } {',
      '  set parentObj [get_bd_cells $parentCell]',
      '  current_bd_instance $parentObj',
      '  set ca [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 ca ]',
      '  set cb [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 cb ]',
      '  set b [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 b ]',
      '  create_hier_cell_h [current_bd_instance .] h',
      '  connect_bd_net -net ca_clk [get_bd_pins ca/clk_out1] [get_bd_pins h/clk]',
      '  connect_bd_net -net cb_clk [get_bd_pins cb/clk_out1] [get_bd_pins b/clk]',
      '  connect_bd_net -net h_rst [get_bd_pins h/rst_out] [get_bd_pins b/rst_n]',
      '}',
      'create_root_design ""',
    ].join('\n'),
    'inner_reset.tcl'
  );
}

/** Platform Designer: a clock source driving a subsystem, whose clock pin feeds its blocks. */
export function loadQsysSubsystemGraph(): SystemGraph {
  const parent = readQsys(
    `<system name="top">
${CLOCK_SOURCE('clk_0', 25000000, 'NONE')}
 <module name="sub_0" kind="sub_system" version="1.0" />
 <connection kind="clock" start="clk_0.clk" end="sub_0.clk" />
</system>`,
    'top.qsys'
  );
  const child = readQsys(
    `<system name="sub_system">
 <interface name="clk" internal="mem.clk1" type="clock" dir="end" />
 <module name="mem" kind="altera_avalon_onchip_memory2" version="1" />
</system>`,
    'sub_system.qsys'
  );
  return graftSubsystem(parent, '/sub_0', child, {
    fileName: 'lib/sub_system.qsys',
    uri: 'file:///ws/lib/sub_system.qsys',
  });
}

/**
 * A stream that only passes through a hierarchy: `a/M_AXIS -> h/S_AXIS`, inside `h` the pin
 * `S_AXIS` is wired to `M_AXIS`, and `h/M_AXIS -> b/S_AXIS`. `a` and `b` sit on different clocks.
 * The net to `b` is written first, so graph order does not already put the driver's net first.
 */
export function loadFeedThroughGraph(): SystemGraph {
  return readBdTcl(
    [
      'proc create_hier_cell_h { parentCell nameHier } {',
      '  set parentObj [get_bd_cells $parentCell]',
      '  set oldCurInst [current_bd_instance .]',
      '  current_bd_instance $parentObj',
      '  set hier_obj [create_bd_cell -type hier $nameHier]',
      '  current_bd_instance $hier_obj',
      '  create_bd_intf_pin -mode Slave -vlnv xilinx.com:interface:axis_rtl:1.0 S_AXIS',
      '  create_bd_intf_pin -mode Master -vlnv xilinx.com:interface:axis_rtl:1.0 M_AXIS',
      '  connect_bd_intf_net -intf_net feed [get_bd_intf_pins S_AXIS] [get_bd_intf_pins M_AXIS]',
      '  current_bd_instance $oldCurInst',
      '}',
      'proc create_root_design { parentCell } {',
      '  set parentObj [get_bd_cells $parentCell]',
      '  current_bd_instance $parentObj',
      '  set a [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 a ]',
      '  set b [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 b ]',
      '  set ca [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 ca ]',
      '  set cb [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 cb ]',
      '  create_hier_cell_h [current_bd_instance .] h',
      '  connect_bd_intf_net -intf_net h_to_b [get_bd_intf_pins h/M_AXIS] [get_bd_intf_pins b/S_AXIS]',
      '  connect_bd_intf_net -intf_net a_to_h [get_bd_intf_pins a/M_AXIS] [get_bd_intf_pins h/S_AXIS]',
      '  connect_bd_net -net clk_a [get_bd_pins ca/clk_out1] [get_bd_pins a/clk]',
      '  connect_bd_net -net clk_b [get_bd_pins cb/clk_out1] [get_bd_pins b/clk]',
      '}',
      'create_root_design ""',
    ].join('\n'),
    'feed_through.tcl'
  );
}
