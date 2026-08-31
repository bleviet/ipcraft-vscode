library ieee;
use ieee.std_logic_1164.all;
use std.env.all;
use work.axi4lite_master_bfm.all;

entity system_verification_tb is
end entity system_verification_tb;

architecture test of system_verification_tb is
  constant clockPeriod : time := 10 ns;
  constant resetCycles : positive := 5;
  constant timeoutCycles : positive := 100;
  constant resetAsserted : std_logic := '0';
  constant resetDeasserted : std_logic := '1';

  signal clock : std_logic := '0';
  signal reset : std_logic := resetAsserted;
  signal awAddress : std_logic_vector(31 downto 0) := (others => '0');
  signal awProtection : std_logic_vector(2 downto 0) := (others => '0');
  signal awValid : std_logic := '0';
  signal awReady : std_logic;
  signal writeData : std_logic_vector(31 downto 0) := (others => '0');
  signal writeStrobe : std_logic_vector(3 downto 0) := (others => '0');
  signal writeValid : std_logic := '0';
  signal writeReady : std_logic;
  signal writeResponse : std_logic_vector(1 downto 0);
  signal writeResponseValid : std_logic;
  signal writeResponseReady : std_logic := '0';
  signal readAddress : std_logic_vector(31 downto 0) := (others => '0');
  signal readProtection : std_logic_vector(2 downto 0) := (others => '0');
  signal readAddressValid : std_logic := '0';
  signal readAddressReady : std_logic;
  signal readData : std_logic_vector(31 downto 0);
  signal readResponse : std_logic_vector(1 downto 0);
  signal readValid : std_logic;
  signal readReady : std_logic := '0';
  signal wrapperAwValid : std_logic_vector(0 to 0) := (others => '0');
  signal wrapperAwReady : std_logic_vector(0 to 0);
  signal wrapperWriteValid : std_logic_vector(0 to 0) := (others => '0');
  signal wrapperWriteReady : std_logic_vector(0 to 0);
  signal wrapperWriteResponseValid : std_logic_vector(0 to 0);
  signal wrapperWriteResponseReady : std_logic_vector(0 to 0) := (others => '0');
  signal wrapperReadAddressValid : std_logic_vector(0 to 0) := (others => '0');
  signal wrapperReadAddressReady : std_logic_vector(0 to 0);
  signal wrapperReadValid : std_logic_vector(0 to 0);
  signal wrapperReadReady : std_logic_vector(0 to 0) := (others => '0');
begin
  clock <= not clock after clockPeriod / 2;
  wrapperAwValid(0) <= awValid;
  awReady <= wrapperAwReady(0);
  wrapperWriteValid(0) <= writeValid;
  writeReady <= wrapperWriteReady(0);
  writeResponseValid <= wrapperWriteResponseValid(0);
  wrapperWriteResponseReady(0) <= writeResponseReady;
  wrapperReadAddressValid(0) <= readAddressValid;
  readAddressReady <= wrapperReadAddressReady(0);
  readValid <= wrapperReadValid(0);
  wrapperReadReady(0) <= readReady;

  dut : entity work.system_wrapper
    port map (
      sys_clk => clock,
      sys_rst_n => reset,
      S_AXI_TEST_awaddr => awAddress,
      S_AXI_TEST_awprot => awProtection,
      S_AXI_TEST_awvalid => wrapperAwValid,
      S_AXI_TEST_awready => wrapperAwReady,
      S_AXI_TEST_wdata => writeData,
      S_AXI_TEST_wstrb => writeStrobe,
      S_AXI_TEST_wvalid => wrapperWriteValid,
      S_AXI_TEST_wready => wrapperWriteReady,
      S_AXI_TEST_bresp => writeResponse,
      S_AXI_TEST_bvalid => wrapperWriteResponseValid,
      S_AXI_TEST_bready => wrapperWriteResponseReady,
      S_AXI_TEST_araddr => readAddress,
      S_AXI_TEST_arprot => readProtection,
      S_AXI_TEST_arvalid => wrapperReadAddressValid,
      S_AXI_TEST_arready => wrapperReadAddressReady,
      S_AXI_TEST_rdata => readData,
      S_AXI_TEST_rresp => readResponse,
      S_AXI_TEST_rvalid => wrapperReadValid,
      S_AXI_TEST_rready => wrapperReadReady    );

  stimulus : process
    variable observedData : std_logic_vector(31 downto 0);
  begin
    report "IPCRAFT_LIFECYCLE:run" severity note;
    reset <= resetAsserted;
    for cycle in 1 to resetCycles loop
      wait until rising_edge(clock);
    end loop;
    reset <= resetDeasserted;
    wait until rising_edge(clock);

    -- Deterministic reset, zero, writable-ones, and walking-one checks.
    axi4lite_read_single(
      clock, x"44A00000", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "STATUS read address=0x44A00000"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000001" and x"FFFFFFFF")
      report "STATUS address=0x44A00000 expected=0x00000001" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"FFFFFFFF",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"FFFFFFFF" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0xFFFFFFFF" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000001",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000001" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000001" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000002",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000002" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000002" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000004",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000004" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000004" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000008",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000008" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000008" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000010",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000010" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000010" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000020",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000020" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000020" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000040",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000040" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000040" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000080",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000080" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000080" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000100",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000100" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000100" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000200",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000200" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000200" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000400",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000400" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000400" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00000800",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00000800" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00000800" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00001000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00001000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00001000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00002000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00002000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00002000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00004000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00004000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00004000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00008000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00008000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00008000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00010000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00010000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00010000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00020000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00020000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00020000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00040000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00040000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00040000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00080000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00080000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00080000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00100000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00100000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00100000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00200000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00200000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00200000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00400000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00400000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00400000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"00800000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"00800000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x00800000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"01000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"01000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x01000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"02000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"02000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x02000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"04000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"04000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x04000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"08000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"08000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x08000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"10000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"10000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x10000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"20000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"20000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x20000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"40000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"40000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x40000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_write_single(
      clock, x"44A00004", x"80000000",
      awAddress, awValid, awReady, writeData, writeStrobe, writeValid, writeReady,
      writeResponse, writeResponseValid, writeResponseReady,
      timeoutCycles, "CONTROL write address=0x44A00004"
    );
    axi4lite_read_single(
      clock, x"44A00004", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "CONTROL read address=0x44A00004"
    );
    assert (observedData and x"FFFFFFFF") = (x"80000000" and x"FFFFFFFF")
      report "CONTROL address=0x44A00004 expected=0x80000000" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    axi4lite_read_single(
      clock, x"44A00008", readAddress, readAddressValid, readAddressReady,
      readData, readResponse, readValid, readReady, observedData,
      timeoutCycles, "IDENTITY read address=0x44A00008"
    );
    assert (observedData and x"FFFFFFFF") = (x"49504352" and x"FFFFFFFF")
      report "IDENTITY address=0x44A00008 expected=0x49504352" &
        " observed=0x" & to_hstring(observedData) & " mask=0xFFFFFFFF"
      severity failure;
    report "SYSTEM VERIFICATION PASS" severity note;
    finish;
  end process stimulus;
end architecture test;
