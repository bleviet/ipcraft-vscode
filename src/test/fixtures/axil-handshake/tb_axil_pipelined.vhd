-- Behavioral check of the generated AXI4-Lite slave with more than one
-- transaction offered at a time, as an interconnect forwarding posted writes
-- does: the next write's W beat arrives while the previous B is still pending
-- (BREADY held low), and the next AR arrives while RVALID is still pending
-- (RREADY held low). Every transaction must complete with the right data.
-- DUT: examples/basic_peripheral (CONTROL @0x0 [3,0] RW, DATA_OUT @0x8 RW).
-- Prints "PASS <check>" / "FAIL <check>" lines for axil-handshake.test.ts.
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity tb_axil_pipelined is
end entity tb_axil_pipelined;

architecture sim of tb_axil_pipelined is
  constant C_TIMEOUT : natural := 200;  -- cycles per handshake

  signal clk     : std_logic := '0';
  signal reset_n : std_logic := '0';
  signal done    : boolean   := false;

  signal awaddr  : std_logic_vector(11 downto 0) := (others => '0');
  signal awvalid : std_logic := '0';
  signal awready : std_logic;
  signal wdata   : std_logic_vector(31 downto 0) := (others => '0');
  signal wstrb   : std_logic_vector(3 downto 0)  := (others => '1');
  signal wvalid  : std_logic := '0';
  signal wready  : std_logic;
  signal bresp   : std_logic_vector(1 downto 0);
  signal bvalid  : std_logic;
  signal bready  : std_logic := '0';
  signal araddr  : std_logic_vector(11 downto 0) := (others => '0');
  signal arvalid : std_logic := '0';
  signal arready : std_logic;
  signal rdata   : std_logic_vector(31 downto 0);
  signal rresp   : std_logic_vector(1 downto 0);
  signal rvalid  : std_logic;
  signal rready  : std_logic := '0';

  type t_addr is array (natural range <>) of std_logic_vector(11 downto 0);
  type t_data is array (natural range <>) of std_logic_vector(31 downto 0);
  constant C_ADDR : t_addr(0 to 1) := (x"008", x"000");
  constant C_DATA : t_data(0 to 1) := (x"A5A55A5A", x"00000009");
begin
  clk <= not clk after 5 ns when not done;

  dut : entity work.basic_peripheral
    port map (
      clk => clk, reset_n => reset_n,
      s_axil_awaddr => awaddr, s_axil_awvalid => awvalid, s_axil_awready => awready, s_axil_awprot => "000",
      s_axil_wdata => wdata, s_axil_wstrb => wstrb, s_axil_wvalid => wvalid, s_axil_wready => wready,
      s_axil_bresp => bresp, s_axil_bvalid => bvalid, s_axil_bready => bready,
      s_axil_araddr => araddr, s_axil_arvalid => arvalid, s_axil_arready => arready, s_axil_arprot => "000",
      s_axil_rdata => rdata, s_axil_rresp => rresp, s_axil_rvalid => rvalid, s_axil_rready => rready,
      o_data => open, o_irq => open
    );

  stimulus : process
    variable v_cycles    : natural;
    variable v_aw_done   : boolean;
    variable v_w_done    : boolean;
    variable v_b_count   : natural;
    variable v_r_count   : natural;
    variable v_rdata     : t_data(0 to 1);
    variable v_ar_count  : natural;
    variable v_ok        : boolean;
  begin
    reset_n <= '0';
    for i in 1 to 5 loop
      wait until rising_edge(clk);
    end loop;
    reset_n <= '1';
    wait until rising_edge(clk);

    ---------------------------------------------------------------------------
    -- Two writes back to back. BREADY stays low for 20 cycles, so the second
    -- W beat is offered while the first write response is pending.
    ---------------------------------------------------------------------------
    v_ok := true;
    v_b_count := 0;
    v_cycles := 0;
    for t in 0 to 1 loop
      awaddr <= C_ADDR(t); wdata <= C_DATA(t);
      awvalid <= '1'; wvalid <= '1';
      v_aw_done := false; v_w_done := false;
      while not (v_aw_done and v_w_done) loop
        wait until rising_edge(clk);
        v_cycles := v_cycles + 1;
        if awvalid = '1' and awready = '1' then
          v_aw_done := true; awvalid <= '0';
        end if;
        if wvalid = '1' and wready = '1' then
          v_w_done := true; wvalid <= '0';
        end if;
        if bvalid = '1' and bready = '1' then
          v_b_count := v_b_count + 1;
        end if;
        bready <= '1' when v_cycles >= 20 else '0';
        if v_cycles > C_TIMEOUT then
          v_ok := false;
          exit;
        end if;
      end loop;
      exit when not v_ok;
    end loop;
    awvalid <= '0'; wvalid <= '0';
    while v_ok and v_b_count < 2 loop
      wait until rising_edge(clk);
      v_cycles := v_cycles + 1;
      bready <= '1' when v_cycles >= 20 else '0';
      if bvalid = '1' and bready = '1' then
        v_b_count := v_b_count + 1;
      end if;
      if v_cycles > C_TIMEOUT then
        v_ok := false;
      end if;
    end loop;
    bready <= '1';
    if v_ok then
      report "PASS writes_complete";
    else
      report "FAIL writes_complete (" & integer'image(v_b_count) & " of 2 write responses)";
    end if;

    ---------------------------------------------------------------------------
    -- Two reads back to back. RREADY stays low for 20 cycles, so the second
    -- AR is offered while the first read's RVALID is pending.
    ---------------------------------------------------------------------------
    v_ok := true;
    v_r_count := 0;
    v_ar_count := 0;
    v_cycles := 0;
    araddr <= C_ADDR(0);
    arvalid <= '1';
    while v_r_count < 2 loop
      wait until rising_edge(clk);
      v_cycles := v_cycles + 1;
      if arvalid = '1' and arready = '1' then
        v_ar_count := v_ar_count + 1;
        if v_ar_count = 2 then
          arvalid <= '0';
        else
          araddr <= C_ADDR(1);
        end if;
      end if;
      if rvalid = '1' and rready = '1' then
        v_rdata(v_r_count) := rdata;
        v_r_count := v_r_count + 1;
      end if;
      rready <= '1' when v_cycles >= 20 else '0';
      if v_cycles > C_TIMEOUT then
        v_ok := false;
        exit;
      end if;
    end loop;
    arvalid <= '0';
    if v_ok then
      report "PASS reads_complete";
      if v_rdata(0) = C_DATA(0) then
        report "PASS read_data_out";
      else
        report "FAIL read_data_out got 0x" & to_hstring(v_rdata(0));
      end if;
      if v_rdata(1) = C_DATA(1) then
        report "PASS read_control";
      else
        report "FAIL read_control got 0x" & to_hstring(v_rdata(1));
      end if;
    else
      report "FAIL reads_complete (" & integer'image(v_r_count) & " of 2 read responses)";
    end if;

    done <= true;
    wait;
  end process stimulus;
end architecture sim;
