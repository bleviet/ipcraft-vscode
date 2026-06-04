## Copying a component instantiation

Once your IP core is defined, IPCraft can generate a ready-to-paste instantiation template for your top-level design.

### What gets copied

**VHDL component + instantiation:**

```vhdl
-- Component declaration
component my_core is
  generic (
    DATA_WIDTH : positive := 32
  );
  port (
    clk         : in  std_logic;
    rst_n       : in  std_logic;
    s_axi_awaddr  : in  std_logic_vector(11 downto 0);
    -- ... all ports
  );
end component;

-- Instantiation
u_my_core : my_core
  generic map (
    DATA_WIDTH => DATA_WIDTH
  )
  port map (
    clk           => clk,
    rst_n         => rst_n,
    s_axi_awaddr  => s_axi_awaddr,
    -- ...
  );
```

**SystemVerilog:**

```systemverilog
my_core #(
  .DATA_WIDTH(DATA_WIDTH)
) u_my_core (
  .clk         (clk),
  .rst_n       (rst_n),
  .s_axi_awaddr(s_axi_awaddr),
  // ...
);
```

### How to use it

Run **IPCraft: Copy Component Instance** (or right-click the `.ip.yml` in the Explorer). The instantiation snippet is copied to your clipboard — paste it into your integrating design and wire up the signals.

> **Tip:** The language of the copied snippet follows `ipcraft.generate.hdlLanguage` in settings. Change it to `systemverilog` if you are integrating into an SV design.
