# Recreate the system-verification example from paths relative to this
# checked-in script. The caller owns the current working directory.

set script_dir [file normalize [file dirname [info script]]]
set project_dir [file normalize [file join [pwd] system_verification_project]]
set part xc7z020clg484-1

create_project -force system_verification_example $project_dir -part $part
set_property target_language VHDL [current_project]
set_property simulator_language Mixed [current_project]

set target_source [file join $script_dir vhdl_target.vhd]
set neighbour_source [file join $script_dir verilog_neighbour.sv]
set neighbour_wrapper [file join $project_dir verilog_neighbour_reference.v]
set wrapper_handle [open $neighbour_wrapper w]
puts $wrapper_handle {module verilog_neighbour_reference (
  (* X_INTERFACE_INFO = "xilinx.com:signal:clock:1.0 clock CLK",
     X_INTERFACE_PARAMETER = "XIL_INTERFACENAME clock, ASSOCIATED_BUSIF S_AXI, ASSOCIATED_RESET reset_n, FREQ_HZ 100000000" *)
  input clock,
  (* X_INTERFACE_INFO = "xilinx.com:signal:reset:1.0 reset_n RST",
     X_INTERFACE_PARAMETER = "XIL_INTERFACENAME reset_n, POLARITY ACTIVE_LOW" *)
  input reset_n,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWADDR",
     X_INTERFACE_PARAMETER = "XIL_INTERFACENAME S_AXI, PROTOCOL AXI4LITE, DATA_WIDTH 32, ADDR_WIDTH 32, READ_WRITE_MODE READ_WRITE" *)
  input [31:0] s_axi_awaddr,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWPROT" *)
  input [2:0] s_axi_awprot,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWVALID" *)
  input s_axi_awvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWREADY" *)
  output s_axi_awready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WDATA" *)
  input [31:0] s_axi_wdata,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WSTRB" *)
  input [3:0] s_axi_wstrb,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WVALID" *)
  input s_axi_wvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WREADY" *)
  output s_axi_wready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI BRESP" *)
  output [1:0] s_axi_bresp,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI BVALID" *)
  output s_axi_bvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI BREADY" *)
  input s_axi_bready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARADDR" *)
  input [31:0] s_axi_araddr,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARPROT" *)
  input [2:0] s_axi_arprot,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARVALID" *)
  input s_axi_arvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARREADY" *)
  output s_axi_arready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RDATA" *)
  output [31:0] s_axi_rdata,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RRESP" *)
  output [1:0] s_axi_rresp,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RVALID" *)
  output s_axi_rvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RREADY" *)
  input s_axi_rready
);
  verilog_neighbour neighbour (
    .clock(clock),
    .reset_n(reset_n),
    .s_axi_awaddr(s_axi_awaddr),
    .s_axi_awprot(s_axi_awprot),
    .s_axi_awvalid(s_axi_awvalid),
    .s_axi_awready(s_axi_awready),
    .s_axi_wdata(s_axi_wdata),
    .s_axi_wstrb(s_axi_wstrb),
    .s_axi_wvalid(s_axi_wvalid),
    .s_axi_wready(s_axi_wready),
    .s_axi_bresp(s_axi_bresp),
    .s_axi_bvalid(s_axi_bvalid),
    .s_axi_bready(s_axi_bready),
    .s_axi_araddr(s_axi_araddr),
    .s_axi_arprot(s_axi_arprot),
    .s_axi_arvalid(s_axi_arvalid),
    .s_axi_arready(s_axi_arready),
    .s_axi_rdata(s_axi_rdata),
    .s_axi_rresp(s_axi_rresp),
    .s_axi_rvalid(s_axi_rvalid),
    .s_axi_rready(s_axi_rready)
  );
endmodule}
close $wrapper_handle

add_files -norecurse [list $target_source $neighbour_source $neighbour_wrapper]
set_property file_type {VHDL} [get_files $target_source]
update_compile_order -fileset sources_1

create_bd_design system

set interconnect [create_bd_cell -type ip -vlnv xilinx.com:ip:axi_interconnect:2.1 axi_interconnect_0]
set_property -dict [list CONFIG.NUM_SI {1} CONFIG.NUM_MI {2}] $interconnect

set control [create_bd_cell -type module -reference vhdl_target control_0]
set neighbour [create_bd_cell -type module -reference verilog_neighbour_reference neighbour_0]

connect_bd_intf_net [get_bd_intf_pins $interconnect/M00_AXI] [get_bd_intf_pins $control/S_AXI]
connect_bd_intf_net [get_bd_intf_pins $interconnect/M01_AXI] [get_bd_intf_pins $neighbour/S_AXI]
set test_interface [create_bd_intf_port -mode Slave -vlnv xilinx.com:interface:aximm_rtl:1.0 S_AXI_TEST]
set_property -dict [list \
  CONFIG.PROTOCOL {AXI4LITE} \
  CONFIG.ADDR_WIDTH {32} \
  CONFIG.DATA_WIDTH {32} \
  CONFIG.HAS_BURST {0} \
  CONFIG.HAS_CACHE {0} \
  CONFIG.HAS_LOCK {0} \
  CONFIG.HAS_QOS {0}] $test_interface
connect_bd_intf_net $test_interface [get_bd_intf_pins $interconnect/S00_AXI]

set clock [create_bd_port -dir I -type clk sys_clk]
set_property -dict [list CONFIG.FREQ_HZ {100000000}] $clock
connect_bd_net $clock \
  [get_bd_pins $interconnect/ACLK] \
  [get_bd_pins $interconnect/S00_ACLK] \
  [get_bd_pins $interconnect/M00_ACLK] \
  [get_bd_pins $interconnect/M01_ACLK] \
  [get_bd_pins $control/clock] \
  [get_bd_pins $neighbour/clock]

set reset_n [create_bd_port -dir I -type rst sys_rst_n]
set_property -dict [list CONFIG.POLARITY {ACTIVE_LOW}] $reset_n
connect_bd_net $reset_n \
  [get_bd_pins $interconnect/ARESETN] \
  [get_bd_pins $interconnect/S00_ARESETN] \
  [get_bd_pins $interconnect/M00_ARESETN] \
  [get_bd_pins $interconnect/M01_ARESETN] \
  [get_bd_pins $control/reset_n] \
  [get_bd_pins $neighbour/reset_n]

set control_segments [get_bd_addr_segs -quiet -of_objects [get_bd_intf_pins $control/S_AXI]]
set neighbour_segments [get_bd_addr_segs -quiet -of_objects [get_bd_intf_pins $neighbour/S_AXI]]
if {[llength $control_segments] != 1 || [llength $neighbour_segments] != 1} {
    error "expected one address segment for each module-reference AXI4-Lite slave"
}

set test_address_space [get_bd_addr_spaces S_AXI_TEST]
assign_bd_address -offset 0x44A00000 -range 0x00001000 \
  -target_address_space $test_address_space [lindex $control_segments 0] -force
assign_bd_address -offset 0x44A01000 -range 0x00001000 \
  -target_address_space $test_address_space [lindex $neighbour_segments 0] -force

validate_bd_design
save_bd_design
