import { parseIpCore } from '../../../../../domain/parse';
import type { SystemGraph } from '../../../../../domain/systemGraph';
import { readBdTcl } from '../../../../../parser/system/BdTclReader';
import { readQsys } from '../../../../../parser/system/QsysReader';
import { readQsysTcl } from '../../../../../parser/system/QsysTclReader';
import { definitionFromIpCore } from '../../../../../services/systemDiagram/enrichment/instanceDefinition';

export const IP_YML = `
vlnv: { vendor: Acme.com, library: ip, name: My_Core, version: "1.0" }
clocks:
  - { name: s_axi_aclk }
  - { name: aux_clk, direction: in, width: 1 }
resets:
  - { name: s_axi_aresetn, polarity: activeLow }
interrupts:
  - { name: irq }
ports:
  - { name: data_out, direction: out, width: 8 }
  - { name: flag, direction: in }
busInterfaces:
  - { name: S_AXI, type: "ipcraft:busif:axi4_lite:1.0", mode: slave, physicalPrefix: s_axi_ }
  - { name: M_ST, type: AXIS, mode: source, physicalPrefix: m_st_ }
`;

export const ipCore = parseIpCore(IP_YML);
export const ipDefinition = definitionFromIpCore(
  ipCore,
  '/ws/my_core.ip.yml',
  'file:///ws/my_core.ip.yml',
  'my_core.ip.yml'
);

/** One Vivado ip cell with the VLNV of {@link IP_YML} (different case) and one module reference. */
export const bdGraph: SystemGraph = readBdTcl(
  [
    'create_bd_design "d"',
    'set my_core_0 [ create_bd_cell -type ip -vlnv acme.com:ip:my_core:1.0 my_core_0 ]',
    'set other_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:other:1.0 other_0 ]',
    'set pulse_0 [ create_bd_cell -type module -reference pulse_gen pulse_0 ]',
    'connect_bd_intf_net [get_bd_intf_pins my_core_0/S_AXI] [get_bd_intf_pins other_0/M_AXI]',
    'connect_bd_net [get_bd_pins my_core_0/s_axi_aclk] [get_bd_pins other_0/clk]',
    'connect_bd_net [get_bd_pins my_core_0/stale_pin] [get_bd_pins other_0/x]',
    'connect_bd_net [get_bd_pins my_core_0/DATA_OUT] [get_bd_pins other_0/y]',
  ].join('\n'),
  'd.tcl'
);

export const qsysGraph: SystemGraph = readQsys(
  `<system name="s">
 <module name="cpu" kind="MY_CORE" version="2.0" />
 <module name="other" kind="not_defined" version="1" />
</system>`,
  's.qsys'
);

export const qsysTclGraph: SystemGraph = readQsysTcl(
  'create_system s\nadd_instance cpu MY_CORE 2.0\nadd_instance other not_defined 1',
  's.tcl'
);
