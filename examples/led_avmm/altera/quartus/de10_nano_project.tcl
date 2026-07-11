# Create the project and overwrite any settings files that exist
project_new led_avmm -revision de10_nano -overwrite

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

# IPCraft-generated led_controller_avmm RTL (package, core, bus wrapper, top, regs)
set_global_assignment -name VHDL_FILE ../../rtl/led_controller_avmm_pkg.vhd
set_global_assignment -name VHDL_FILE ../../rtl/led_controller_avmm_regs.vhd
set_global_assignment -name VHDL_FILE ../../rtl/led_controller_avmm_core.vhd
set_global_assignment -name VHDL_FILE ../../rtl/led_controller_avmm_avmm.vhd
set_global_assignment -name VHDL_FILE ../../rtl/led_controller_avmm.vhd

# Platform Designer generated system (includes all sub-IP files)
set_global_assignment -name QIP_FILE ../qsys/led_avmm_system_gen/synthesis/led_avmm_system.qip

# Pin assignments
source de10_nano_pin_assignments.tcl

project_close
