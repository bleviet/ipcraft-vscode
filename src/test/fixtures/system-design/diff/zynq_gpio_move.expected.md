## System design changes: zynq_gpio_system

Comparing `HEAD` (base) with `working tree`.

**+0 added · −0 removed · ~2 changed · »1 moved · v0 version only**

### Level `/`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| ~ | `axi_periph` | pin `M00_AXI` connects to | `axi_gpio_0/S_AXI` | `gpio_block/S_AXI_0` |
| ~ | `gpio_block` | pin `S_AXI_0` added | | `axi_periph/M00_AXI` |
| ~ | `gpio_block` | pin `S_AXI_0` inside added | | `axi_gpio_0/S_AXI` |

### Level `/gpio_block`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| » | `axi_gpio_0` | moved | `/axi_gpio_0` | `/gpio_block/axi_gpio_0` |
| ~ | `axi_gpio_0` | pin `S_AXI` connects to | `axi_periph/M00_AXI` | `S_AXI_0` |
| ~ | `axi_gpio_0` | pin `s_axi_aclk` connects to | `axi_periph/ACLK, gpio_block/clk, sys_ps7/FCLK_CLK0` | `axi_gpio_1/s_axi_aclk, clk` |
