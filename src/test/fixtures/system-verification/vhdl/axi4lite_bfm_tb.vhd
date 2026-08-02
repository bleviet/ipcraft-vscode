library ieee;
use ieee.std_logic_1164.all;

library std;
use std.env.all;

use work.axi4lite_master_bfm.all;

entity axi4lite_bfm_tb is
  generic (
    testCase : natural := 0
  );
end entity axi4lite_bfm_tb;

architecture test of axi4lite_bfm_tb is
  constant clockPeriod : time := 10 ns;
  constant timeoutCycles : positive := 4;

  signal clock              : std_logic := '0';
  signal resetN             : std_logic := '0';
  signal awAddress          : std_logic_vector(31 downto 0) := (others => '0');
  signal awValid            : std_logic := '0';
  signal awReady            : std_logic;
  signal writeData          : std_logic_vector(31 downto 0) := (others => '0');
  signal writeStrobe        : std_logic_vector(3 downto 0) := (others => '0');
  signal writeValid         : std_logic := '0';
  signal writeReady         : std_logic;
  signal writeResponse      : std_logic_vector(1 downto 0);
  signal writeResponseValid : std_logic;
  signal writeResponseReady : std_logic := '0';
  signal readAddress        : std_logic_vector(31 downto 0) := (others => '0');
  signal readAddressValid   : std_logic := '0';
  signal readAddressReady   : std_logic;
  signal readData           : std_logic_vector(31 downto 0);
  signal readResponse       : std_logic_vector(1 downto 0);
  signal readValid          : std_logic;
  signal readReady          : std_logic := '0';
  signal awAcceptCount      : natural;
  signal writeAcceptCount   : natural;
  signal readAcceptCount    : natural;
  signal lastWriteStrobe    : std_logic_vector(3 downto 0);
begin
  clock <= not clock after clockPeriod / 2;

  slave : entity work.axi4lite_slave_model
    port map (
      clock              => clock,
      resetN             => resetN,
      awAddress          => awAddress,
      awValid            => awValid,
      awReady            => awReady,
      writeData          => writeData,
      writeStrobe        => writeStrobe,
      writeValid         => writeValid,
      writeReady         => writeReady,
      writeResponse      => writeResponse,
      writeResponseValid => writeResponseValid,
      writeResponseReady => writeResponseReady,
      readAddress        => readAddress,
      readAddressValid   => readAddressValid,
      readAddressReady   => readAddressReady,
      readData           => readData,
      readResponse       => readResponse,
      readValid          => readValid,
      readReady          => readReady,
      awAcceptCount      => awAcceptCount,
      writeAcceptCount   => writeAcceptCount,
      readAcceptCount    => readAcceptCount,
      lastWriteStrobe    => lastWriteStrobe
    );

  stimulus : process
    variable observedData : std_logic_vector(31 downto 0);
  begin
    resetN <= '0';
    wait for 3 * clockPeriod;
    wait until rising_edge(clock);
    resetN <= '1';
    wait until rising_edge(clock);

    case testCase is
      when 0 =>
        axi4lite_write_single(
          clock, x"00000000", x"A1B2C3D4",
          awAddress, awValid, awReady,
          writeData, writeStrobe, writeValid, writeReady,
          writeResponse, writeResponseValid, writeResponseReady,
          timeoutCycles, "full-word-0"
        );
        axi4lite_read_single(
          clock, x"00000000",
          readAddress, readAddressValid, readAddressReady,
          readData, readResponse, readValid, readReady, observedData,
          timeoutCycles, "readback-0"
        );
        assert observedData = x"A1B2C3D4"
          report "full-word-0: readback mismatch"
          severity failure;

        axi4lite_write_single(
          clock, x"00000004", x"01020304",
          awAddress, awValid, awReady,
          writeData, writeStrobe, writeValid, writeReady,
          writeResponse, writeResponseValid, writeResponseReady,
          timeoutCycles, "full-word-1"
        );
        axi4lite_read_single(
          clock, x"00000004",
          readAddress, readAddressValid, readAddressReady,
          readData, readResponse, readValid, readReady, observedData,
          timeoutCycles, "readback-1"
        );
        assert observedData = x"01020304"
          report "full-word-1: readback mismatch"
          severity failure;
        assert lastWriteStrobe = "1111"
          report "BFM did not assert every byte strobe for a single-word write"
          severity failure;
        assert awAcceptCount = 2 and writeAcceptCount = 2 and readAcceptCount = 2
          report "BFM issued an unexpected transaction count"
          severity failure;
        report "BFM PASS" severity note;
        finish;

      when 1 =>
        axi4lite_write_single(
          clock, x"00000020", x"BAD00002",
          awAddress, awValid, awReady,
          writeData, writeStrobe, writeValid, writeReady,
          writeResponse, writeResponseValid, writeResponseReady,
          timeoutCycles, "write-slverr"
        );

      when 2 =>
        axi4lite_read_single(
          clock, x"00000024",
          readAddress, readAddressValid, readAddressReady,
          readData, readResponse, readValid, readReady, observedData,
          timeoutCycles, "read-decerr"
        );

      when 3 =>
        axi4lite_write_single(
          clock, x"00000030", x"DEAD0030",
          awAddress, awValid, awReady,
          writeData, writeStrobe, writeValid, writeReady,
          writeResponse, writeResponseValid, writeResponseReady,
          timeoutCycles, "write-aw-stall"
        );

      when 4 =>
        axi4lite_read_single(
          clock, x"00000034",
          readAddress, readAddressValid, readAddressReady,
          readData, readResponse, readValid, readReady, observedData,
          timeoutCycles, "read-ar-stall"
        );

      when others =>
        assert false report "unsupported testCase" severity failure;
    end case;

    assert false report "expected BFM failure was not reported" severity failure;
  end process;
end architecture test;
