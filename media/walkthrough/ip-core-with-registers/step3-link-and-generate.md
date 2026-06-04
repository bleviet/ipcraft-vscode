## From spec to RTL in one command

When you run **Scaffold Full Project** from an IP core that has a memory map, IPCraft generates a complete, synthesisable register interface automatically.

### What gets generated

```
rtl/
  my_core_pkg.vhd          ← register offset constants, field masks, types
  my_core_top.vhd          ← top-level entity (instantiates core + wrapper)
  my_core_core.vhd         ← your logic skeleton (user-owned, never overwritten)
  my_core_axil_wrap.vhd    ← AXI-Lite bus wrapper (decode + handshake)
  my_core_regfile.vhd      ← register read/write decoder
```

### Bus protocol selection

The generated wrapper matches the bus interfaces in your canvas:

| Canvas interface | Generated wrapper |
|-----------------|-------------------|
| AXI4-Lite Slave | `*_axil_wrap.vhd` |
| Avalon-MM Slave | `*_avmm_wrap.vhd` |

If no bus interface is present when you scaffold, IPCraft adds an AXI-Lite slave automatically based on the memory map.

### The core-to-regfile connection

Your `*_core.vhd` skeleton receives a record signal with one field per register — you read control registers directly and write status fields back. No AXI protocol knowledge needed inside the core.

```vhdl
-- Inside my_core_core.vhd (simplified)
proc_main : process(clk)
begin
  if rising_edge(clk) then
    threshold <= regs_i.threshold;  -- read a control register
    regs_o.status_done <= done_flag; -- write a status register
  end if;
end process;
```
