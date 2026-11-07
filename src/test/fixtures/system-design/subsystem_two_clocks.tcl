################################################################
# This is a generated script based on design: subsystem_two_clocks
#
# Though there are limitations about the generated script,
# the main purpose of this utility is to make learning
# IP Integrator Tcl commands easier.
################################################################

# Synthetic fixture for IPCraft's clock and reset domain analysis (issue #243).
# It follows the structure of Vivado's write_bd_tcl output for a kernel-style
# subsystem; it was written by hand and is not exported from a real project.
#
# The clocks enter through two input ports. s_axi_aclk declares its frequency
# with -freq_hz, m_axis_clk declares none. The producer and the monitor are fed
# by the same port, so they share one clock; the stream from the producer to the
# consumer runs from one port clock to the other. Whether the two ports carry
# the same clock is decided by the top level that uses this subsystem.

set scripts_vivado_version 2024.2
set current_vivado_version [version -short]

set list_projs [get_projects -quiet]
if { $list_projs eq "" } {
   create_project project_1 myproj -part xcvc1902-vsva2197-2MP-e-S
}

# CHANGE DESIGN NAME HERE
variable design_name
set design_name subsystem_two_clocks

create_bd_design $design_name
current_bd_design $design_name

##################################################################
# DESIGN PROCs
##################################################################

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

  # Create ports
  set m_axis_clk [ create_bd_port -dir I -type clk m_axis_clk ]
  set s_axi_aclk [ create_bd_port -dir I -type clk -freq_hz 100000000 s_axi_aclk ]

  # Create instance: producer_0, and set properties
  set producer_0 [ create_bd_cell -type ip -vlnv example.com:ipcraft:producer:1.0 producer_0 ]

  # Create instance: consumer_0, and set properties
  set consumer_0 [ create_bd_cell -type ip -vlnv example.com:ipcraft:consumer:1.0 consumer_0 ]

  # Create instance: monitor_0, and set properties
  set monitor_0 [ create_bd_cell -type ip -vlnv example.com:ipcraft:monitor:1.0 monitor_0 ]

  # Create interface connections
  connect_bd_intf_net -intf_net producer_0_M_AXIS [get_bd_intf_pins consumer_0/S_AXIS] [get_bd_intf_pins producer_0/M_AXIS]

  # Create port connections
  connect_bd_net -net m_axis_clk_1 [get_bd_pins consumer_0/aclk] [get_bd_ports m_axis_clk]
  connect_bd_net -net s_axi_aclk_1 [get_bd_ports s_axi_aclk] \
  [get_bd_pins monitor_0/clk] \
  [get_bd_pins producer_0/aclk]

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
