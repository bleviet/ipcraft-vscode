## System design changes: nios_system

Comparing `HEAD` (base) with `working tree`.

**+1 added · −1 removed · ~4 changed · v1 version only**

### Address map
| | Address space | Segment | Base | Current |
|---|---|---|---|---|
| ~ | `nios2_gen2_0.data_master` | `jtag_uart_0.avalon_jtag_slave` | `0x00011000` | `0x00012000` |

### External ports
| | Port | Base | Current |
|---|---|---|---|
| − | `pio_0_external_connection` | direction `slave` · interfaceType `conduit` · connects to `pio_0/external_connection` | |

### Level `/`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| + | `fifo_0` | added | | `altera_avalon_sc_fifo:18.1` |
| + | `fifo_0` | pin `in` connects to | | `st_source_0/src` |
| + | `fifo_0` | pin `out` connects to | | `st_sink_0/sink` |
| ~ | `pio_0` | parameter `width` | `8` | `16` |
| ~ | `st_sink_0` | pin `sink` connects to | `st_source_0/src` | `fifo_0/out` |
| ~ | `st_source_0` | pin `src` connects to | `st_sink_0/sink` | `fifo_0/in` |
| v | `sysid_qsys_0` | version | `altera_avalon_sysid_qsys:18.1` | `altera_avalon_sysid_qsys:19.1` |
