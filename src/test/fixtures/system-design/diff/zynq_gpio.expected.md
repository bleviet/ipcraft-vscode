## System design changes: zynq_gpio_system

Comparing `HEAD` (base) with `working tree`.

**+1 added · −4 removed · ~2 changed · v1 version only · 0 new findings · 1 resolved finding**

### Findings
| | Finding | Where | Detail |
|---|---|---|---|
| Resolved | undriven pin | `led_o` | |

Findings are computed from the design files alone; workspace definitions are not used, so pins of blocks without a known pin list are not checked.

### Address map
| | Address space | Segment | Base | Current |
|---|---|---|---|---|
| − | `sys_ps7/Data` | `axi_gpio_0/S_AXI/Mem` | `0x00000000` · `0x100000000` | |
| − | `sys_ps7/Data` | `axi_gpio_0/S_AXI/Reg` | `0x41200000` · `0x00010000` | |
| ~ | `sys_ps7/Data` | `gpio_block/axi_gpio_1/S_AXI/Reg` | `0x41210000` · `0x00010000` | `0x41220000` · `0x00010000` |

### External ports
| | Port | Base | Current |
|---|---|---|---|
| − | `led_o` | direction `out` · width `7:0` · not connected | |

### Level `/`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| − | `axi_gpio_0` | removed | `xilinx.com:ip:axi_gpio:2.0` | |
| − | `axi_gpio_0` | pin `S_AXI` connects to | `axi_periph/M00_AXI` | |
| − | `axi_gpio_0` | pin `s_axi_aclk` connects to | `axi_periph/ACLK, gpio_block/clk, sys_ps7/FCLK_CLK0` | |
| + | `axis_data_fifo_0` | added | | `xilinx.com:ip:axis_data_fifo:2.0` |
| + | `axis_data_fifo_0` | pin `s_axis_aclk` connects to | | `sys_ps7/FCLK_CLK1` |
| + | `axis_data_fifo_0` | pin `s_axis_aresetn` connects to | | `ghost_ctrl/rst_n, sync_0/rst_n_in, sys_rst_n` |
| ~ | `sys_ps7` | parameter `CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ` | `100` | `150` |

### Level `/gpio_block`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| v | `axi_gpio_1` | version | `xilinx.com:ip:axi_gpio:2.0` | `xilinx.com:ip:axi_gpio:2.1` |
