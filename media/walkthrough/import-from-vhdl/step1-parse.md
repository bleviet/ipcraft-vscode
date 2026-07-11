## What the VHDL parser detects

IPCraft reads your entity declaration and reverse-engineers an `.ip.yml` automatically. It handles everything from a minimal entity to one with hundreds of ports.

### Detection rules

| What it finds | How it recognises it |
|--------------|----------------------|
| **Clocks** | Port names containing `clk` or `clock` |
| **Active-low resets** | Port names ending in `_n` that contain `rst` or `reset` |
| **Active-high resets** | Port names containing `rst` or `reset` (without `_n`) |
| **AXI4-Lite signals** | Groups of ports sharing an AXI prefix (e.g. `s_axi_awaddr`) |
| **Scalar ports** | Everything else — preserved as `in` / `out` / `inout` |

### What to prepare

The parser works best on a single entity declaration. If your `.vhd` file contains multiple entities or architectures, the parser will use the first entity it finds.

```vhdl
-- This is all the parser needs:
entity my_core is
  generic (
    DATA_WIDTH : positive := 32
  );
  port (
    clk     : in  std_logic;
    rst_n   : in  std_logic;
    i_data  : in  std_logic_vector(DATA_WIDTH-1 downto 0);
    o_valid : out std_logic
  );
end entity;
```

### Running the command

Open the `.vhd` file in VS Code (or have it open in the active editor), then run **IPCraft: Import from VHDL (Experimental)**. A Save dialog will ask where to write the output `.ip.yml`.
