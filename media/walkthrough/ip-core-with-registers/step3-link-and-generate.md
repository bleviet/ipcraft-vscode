## From spec to RTL in one command

After the imported memory map is attached through `memoryMapRef` to a
memory-mapped slave, select the `builtin-ipcraft` scaffold pack and run
**IPCraft: Scaffold Project**. IPCraft then generates a complete,
synthesisable register interface.

### What gets generated

```
rtl/
  my_core_pkg.vhd    ← register offset constants, types
  my_core.vhd         ← top-level entity (instantiates core + wrapper)
  my_core_core.vhd    ← generated logic skeleton (managed by default)
  my_core_axil.vhd    ← AXI-Lite bus wrapper (decode + handshake)
  my_core_regs.vhd    ← register read/write decoder
```

### Bus protocol selection

The generated wrapper matches the bus interfaces in your canvas:

| Canvas interface | Generated wrapper |
|-----------------|-------------------|
| AXI4-Lite Slave | `*_axil.vhd` |
| Avalon-MM Slave | `*_avmm.vhd` |

IPCraft does not infer or add a bus interface from the memory map. If the
wrapper or register file is missing from staging, confirm that the IP core has
a supported slave interface and that its `memoryMapRef` names the imported
map.

### The core-to-regfile connection

Your `*_core.vhd` skeleton receives a record signal with one field per register — you read control registers directly and write status fields back. No AXI protocol knowledge needed inside the core.

```vhdl
-- Inside my_core_core.vhd (simplified)
p_main : process(clk)
begin
  if rising_edge(clk) then
    if regs_in.ctrl.enable = '1' then
      null; -- Run the enabled datapath here.
    end if;
    regs_out.status.done <= done_flag; -- hardware-driven field
  end if;
end process;
```

The record and field names come from your register and field names after
normalisation. Inspect the generated package for the exact types.

> **Important:** `builtin-ipcraft` regenerates `*_core.vhd` / `*_core.sv`.
> Mark the file `managed: false` before adding hand-written logic, or use a
> scaffold pack that protects its core rule.
