package require -exact qsys 16.1

# Synthetic qsys-script system: a Nios V and an HPS sharing peripherals.
create_system niosv_hps_system
set_project_property DEVICE_FAMILY {Cyclone V}

set cpu niosv

add_instance clk_0 altera_clock_bridge
add_instance reset_bridge altera_reset_bridge
add_instance niosv intel_niosv_m 25.1
add_instance hps_0 altera_hps
add_instance onchip_mem altera_avalon_onchip_memory2
add_instance jtag_uart altera_avalon_jtag_uart
add_instance led_pio altera_avalon_pio
add_instance button_pio altera_avalon_pio
add_instance accel custom_accel
add_instance spare_pio altera_avalon_pio
set_instance_property spare_pio ENABLED false

set_instance_parameter_value clk_0 EXPLICIT_CLOCK_RATE {50000000.0}
set_instance_parameter_value led_pio width 8

# clocks and resets
add_connection clk_0.out_clk reset_bridge.clk
add_connection clk_0.out_clk $cpu.clk
add_connection clk_0.out_clk onchip_mem.clk1
add_connection clk_0.out_clk jtag_uart.clk
add_connection clk_0.out_clk led_pio.clk
add_connection clk_0.out_clk button_pio.clk
add_connection clk_0.out_clk accel.clk
add_connection clk_0.out_clk hps_0.h2f_lw_axi_clock
add_connection clk_0.out_clk spare_pio.clk
add_connection reset_bridge.out_reset niosv.reset
add_connection reset_bridge.out_reset onchip_mem.reset1
add_connection reset_bridge.out_reset jtag_uart.reset
add_connection reset_bridge.out_reset led_pio.reset
add_connection hps_0.h2f_reset button_pio.reset
add_connection hps_0.h2f_reset accel.reset

# Nios V buses and interrupts
add_connection niosv.data_manager onchip_mem.s1
add_connection niosv.data_manager jtag_uart.avalon_jtag_slave
add_connection niosv.data_manager led_pio.s1
add_connection niosv.data_manager niosv.timer_sw_agent
add_connection niosv.data_manager niosv.dm_agent
add_connection niosv.instruction_manager onchip_mem.s1
add_connection niosv.instruction_manager niosv.dm_agent
add_connection niosv.platform_irq_rx jtag_uart.irq
add_connection niosv.platform_irq_rx button_pio.irq

# HPS lightweight bridge
add_connection hps_0.h2f_lw_axi_master button_pio.s1
add_connection hps_0.h2f_lw_axi_master accel.avs
add_connection accel.avm onchip_mem.s2
add_connection hps_0.f2h_irq0 accel.interrupt_sender
add_connection accel.status accel.debug_probe
add_connection accel.trigger led_pio.misc clock

set_connection_parameter_value niosv.data_manager/onchip_mem.s1 baseAddress {0x00000000}
set_connection_parameter_value niosv.data_manager/jtag_uart.avalon_jtag_slave baseAddress {0x00010100}
set_connection_parameter_value niosv.data_manager/led_pio.s1 baseAddress {0x00010010}
set_connection_parameter_value niosv.platform_irq_rx/jtag_uart.irq irqNumber {0}
set_connection_parameter_value niosv.platform_irq_rx/button_pio.irq irqNumber {1}
set_connection_parameter_value hps_0.h2f_lw_axi_master/button_pio.s1 baseAddress {0x0000}
set_connection_parameter_value hps_0.h2f_lw_axi_master/accel.avs \
    baseAddress {0x1000}

foreach target {led_pio button_pio} {
    add_connection hps_0.h2f_reset $target.reset
}

add_interface clk clock sink
set_interface_property clk EXPORT_OF clk_0.in_clk
add_interface reset reset sink
set_interface_property reset EXPORT_OF reset_bridge.in_reset
add_interface led_external_connection conduit end
set_interface_property led_external_connection EXPORT_OF led_pio.external_connection
add_interface debug_probe conduit end

auto_assign_system_base_addresses
save_system niosv_hps_system.qsys
puts "saved"
