################################################################
# This is a generated script based on design: versal_clocks
#
# Though there are limitations about the generated script,
# the main purpose of this utility is to make learning
# IP Integrator Tcl commands easier.
################################################################

# Synthetic fixture for IPCraft's clock and reset domain analysis (issue #243).
# It follows the structure of Vivado's write_bd_tcl output for a Versal platform;
# it was written by hand and is not exported from a real project.
#
# Like in an exported script, the endpoints of a net are listed alphabetically,
# so the driver of a net is not first: the clocking wizard output clk_out1 is
# listed after the loads that sort before it. No frequency is set anywhere, so
# the clocks are told apart by the pin that drives them alone.
#
# CIPS pl0_ref_clk feeds the clocking wizard. Its outputs clk_out1 and clk_out2
# clock two groups of blocks; the stream between the groups, and the reset of
# the clk_out2 group into stream_src on clk_out1, run between clocks of one
# generator. The wizard status output locked is named like a clock but is none.

set scripts_vivado_version 2024.2
set current_vivado_version [version -short]

################################################################
# START
################################################################

set list_projs [get_projects -quiet]
if { $list_projs eq "" } {
   create_project project_1 myproj -part xcvc1902-vsva2197-2MP-e-S
}

# CHANGE DESIGN NAME HERE
variable design_name
set design_name versal_clocks

set cur_design [current_bd_design -quiet]
set list_cells [get_bd_cells -quiet]

if { ${design_name} eq "" } {
   set nRet 1
} elseif { ${cur_design} ne "" && ${list_cells} eq "" } {
   if { $cur_design ne $design_name } {
      set design_name [get_property NAME $cur_design]
   }
} else {
   create_bd_design $design_name
   current_bd_design $design_name
}

##################################################################
# DESIGN PROCs
##################################################################

# Procedure to create entire design; Provide argument to make
# procedure reusable. If parentCell is "", will use root.
proc create_root_design { parentCell } {

  variable script_folder
  variable design_name

  if { $parentCell eq "" } {
     set parentCell [get_bd_cells /]
  }

  # Get object for parentCell
  set parentObj [get_bd_cells $parentCell]
  if { $parentObj == "" } {
     catch {common::send_gid_msg -ssname BD::TCL -id 2090 -severity "ERROR" "Unable to find parent cell <$parentCell>!"}
     return
  }

  # Save current instance; Restore later
  set oldCurInst [current_bd_instance .]

  # Set parent object as current
  current_bd_instance $parentObj

  # Create instance: ps_cips, and set properties
  set ps_cips [ create_bd_cell -type ip -vlnv xilinx.com:ip:versal_cips:3.4 ps_cips ]

  # Create instance: clk_wizard_0, and set properties
  set clk_wizard_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wizard:1.0 clk_wizard_0 ]
  set_property -dict [list \
    CONFIG.CLKOUT_USED {true,true} \
    CONFIG.NUM_OUT_CLKS {2} \
  ] $clk_wizard_0


  # Create instance: rst_clk_out1, and set properties
  set rst_clk_out1 [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 rst_clk_out1 ]

  # Create instance: rst_clk_out2, and set properties
  set rst_clk_out2 [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 rst_clk_out2 ]

  # Create instance: ctrl_smc, and set properties
  set ctrl_smc [ create_bd_cell -type ip -vlnv xilinx.com:ip:smartconnect:1.0 ctrl_smc ]
  set_property CONFIG.NUM_SI {1} $ctrl_smc


  # Create instance: axi_gpio_0, and set properties
  set axi_gpio_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:axi_gpio:2.0 axi_gpio_0 ]

  # Create instance: stream_src, and set properties
  set stream_src [ create_bd_cell -type ip -vlnv example.com:ipcraft:stream_src:1.0 stream_src ]

  # Create instance: stream_sink, and set properties
  set stream_sink [ create_bd_cell -type ip -vlnv example.com:ipcraft:stream_sink:1.0 stream_sink ]

  # Create interface connections
  connect_bd_intf_net -intf_net ctrl_smc_M00_AXI [get_bd_intf_pins axi_gpio_0/S_AXI] [get_bd_intf_pins ctrl_smc/M00_AXI]
  connect_bd_intf_net -intf_net ps_cips_M_AXI_FPD [get_bd_intf_pins ctrl_smc/S00_AXI] [get_bd_intf_pins ps_cips/M_AXI_FPD]
  connect_bd_intf_net -intf_net stream_src_M_AXIS [get_bd_intf_pins stream_sink/S_AXIS] [get_bd_intf_pins stream_src/M_AXIS]

  # Create port connections
  connect_bd_net -net clk_wizard_0_clk_out1 [get_bd_pins axi_gpio_0/s_axi_aclk] \
  [get_bd_pins clk_wizard_0/clk_out1] \
  [get_bd_pins ctrl_smc/aclk] \
  [get_bd_pins ps_cips/m_axi_fpd_aclk] \
  [get_bd_pins rst_clk_out1/slowest_sync_clk] \
  [get_bd_pins stream_src/aclk]
  connect_bd_net -net clk_wizard_0_clk_out2 [get_bd_pins clk_wizard_0/clk_out2] \
  [get_bd_pins rst_clk_out2/slowest_sync_clk] \
  [get_bd_pins stream_sink/aclk]
  connect_bd_net -net clk_wizard_0_locked [get_bd_pins clk_wizard_0/locked] \
  [get_bd_pins rst_clk_out1/dcm_locked] \
  [get_bd_pins rst_clk_out2/dcm_locked]
  connect_bd_net -net ps_cips_pl0_ref_clk [get_bd_pins clk_wizard_0/clk_in1] [get_bd_pins ps_cips/pl0_ref_clk]
  connect_bd_net -net ps_cips_pl0_resetn [get_bd_pins clk_wizard_0/resetn] \
  [get_bd_pins ps_cips/pl0_resetn] \
  [get_bd_pins rst_clk_out1/ext_reset_in] \
  [get_bd_pins rst_clk_out2/ext_reset_in]
  connect_bd_net -net rst_clk_out1_peripheral_aresetn [get_bd_pins axi_gpio_0/s_axi_aresetn] \
  [get_bd_pins ctrl_smc/aresetn] \
  [get_bd_pins rst_clk_out1/peripheral_aresetn]
  connect_bd_net -net rst_clk_out2_peripheral_aresetn [get_bd_pins rst_clk_out2/peripheral_aresetn] \
  [get_bd_pins stream_sink/aresetn] \
  [get_bd_pins stream_src/aresetn]

  # Restore current instance
  current_bd_instance $oldCurInst

  validate_bd_design
  save_bd_design
}
# End of create_root_design()


##################################################################
# MAIN FLOW
##################################################################

create_root_design ""
