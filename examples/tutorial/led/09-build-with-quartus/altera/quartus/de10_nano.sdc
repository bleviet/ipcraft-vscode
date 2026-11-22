#**************************************************************
# Create Clock
#**************************************************************
create_clock -period "50.0 MHz" [get_ports fpga_clk1_50]

#**************************************************************
# JTAG clock (used internally by the Nios II debug unit)
#**************************************************************
create_clock -name {altera_reserved_tck} -period 41.67 [get_ports {altera_reserved_tck}]
set_clock_groups -exclusive -group [get_clocks {altera_reserved_tck}]
