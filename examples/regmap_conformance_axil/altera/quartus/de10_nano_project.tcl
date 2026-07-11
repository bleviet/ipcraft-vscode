# Create the project and overwrite any settings files that exist
project_new regmap_conformance_axil -revision de10_nano -overwrite

# Device settings
set_global_assignment -name FAMILY "Cyclone V"
set_global_assignment -name DEVICE 5CSEBA6U23I7

set_global_assignment -name VHDL_INPUT_VERSION VHDL_2008

set_global_assignment -name SDC_FILE de10_nano.sdc

# Top-level entity
set_global_assignment -name TOP_LEVEL_ENTITY de10_nano_top

# Source files
set_global_assignment -name VHDL_FILE ../../../common/ip/power_on_reset/power_on_reset_generator.vhd
set_global_assignment -name VHDL_FILE ../hdl/de10_nano_top.vhd

# IPCraft-generated regmap_conformance_axil RTL (package, regs, core, bus wrapper, top)
set_global_assignment -name VHDL_FILE ../../rtl/regmap_conformance_axil_pkg.vhd
set_global_assignment -name VHDL_FILE ../../rtl/regmap_conformance_axil_regs.vhd
set_global_assignment -name VHDL_FILE ../../rtl/regmap_conformance_axil_core.vhd
set_global_assignment -name VHDL_FILE ../../rtl/regmap_conformance_axil_axil.vhd
set_global_assignment -name VHDL_FILE ../../rtl/regmap_conformance_axil.vhd

# Platform Designer generated system (includes all sub-IP files)
set_global_assignment -name QIP_FILE ../qsys/regmap_conformance_axil_system_gen/synthesis/regmap_conformance_axil_system.qip

# Pin assignments
source de10_nano_pin_assignments.tcl

project_close
