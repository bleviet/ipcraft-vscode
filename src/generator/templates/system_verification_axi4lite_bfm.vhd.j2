library ieee;
use ieee.std_logic_1164.all;

package axi4lite_master_bfm is
  procedure axi4lite_write_single(
    signal clock              : in  std_logic;
    constant address          : in  std_logic_vector;
    constant data             : in  std_logic_vector;
    signal awAddress          : out std_logic_vector;
    signal awValid            : out std_logic;
    signal awReady            : in  std_logic;
    signal writeData          : out std_logic_vector;
    signal writeStrobe        : out std_logic_vector;
    signal writeValid         : out std_logic;
    signal writeReady         : in  std_logic;
    signal writeResponse      : in  std_logic_vector(1 downto 0);
    signal writeResponseValid : in  std_logic;
    signal writeResponseReady : out std_logic;
    constant timeoutCycles    : in  positive;
    constant transactionContext : in string
  );

  procedure axi4lite_read_single(
    signal clock             : in  std_logic;
    constant address         : in  std_logic_vector;
    signal readAddress       : out std_logic_vector;
    signal readAddressValid  : out std_logic;
    signal readAddressReady  : in  std_logic;
    signal readData          : in  std_logic_vector;
    signal readResponse      : in  std_logic_vector(1 downto 0);
    signal readValid         : in  std_logic;
    signal readReady         : out std_logic;
    variable observedData    : out std_logic_vector;
    constant timeoutCycles   : in  positive;
    constant transactionContext : in string
  );
end package axi4lite_master_bfm;

package body axi4lite_master_bfm is
  procedure axi4lite_write_single(
    signal clock              : in  std_logic;
    constant address          : in  std_logic_vector;
    constant data             : in  std_logic_vector;
    signal awAddress          : out std_logic_vector;
    signal awValid            : out std_logic;
    signal awReady            : in  std_logic;
    signal writeData          : out std_logic_vector;
    signal writeStrobe        : out std_logic_vector;
    signal writeValid         : out std_logic;
    signal writeReady         : in  std_logic;
    signal writeResponse      : in  std_logic_vector(1 downto 0);
    signal writeResponseValid : in  std_logic;
    signal writeResponseReady : out std_logic;
    constant timeoutCycles    : in  positive;
    constant transactionContext : in string
  ) is
    variable awPending : boolean := true;
    variable wPending  : boolean := true;
  begin
    awAddress <= address;
    awValid <= '1';
    writeData <= data;
    writeStrobe <= (writeStrobe'range => '1');
    writeValid <= '1';

    for cycle in 1 to timeoutCycles loop
      wait until rising_edge(clock);
      if awPending and awReady = '1' then
        awPending := false;
        awValid <= '0';
      end if;
      if wPending and writeReady = '1' then
        wPending := false;
        writeValid <= '0';
      end if;
      exit when not awPending and not wPending;
    end loop;
    assert not awPending
      report transactionContext & ": write AW timeout address=0x" & to_hstring(address) &
        " data=0x" & to_hstring(data)
      severity failure;
    assert not wPending
      report transactionContext & ": write W timeout address=0x" & to_hstring(address) &
        " data=0x" & to_hstring(data)
      severity failure;

    writeResponseReady <= '1';
    for cycle in 1 to timeoutCycles loop
      wait until rising_edge(clock);
      if writeResponseValid = '1' then
        assert writeResponse = "00"
          report transactionContext & ": write B response error address=0x" &
            to_hstring(address) & " data=0x" & to_hstring(data) &
            " response=0x" & to_hstring(writeResponse)
          severity failure;
        writeResponseReady <= '0';
        return;
      end if;
    end loop;
    writeResponseReady <= '0';
    assert false
      report transactionContext & ": write B timeout address=0x" & to_hstring(address) &
        " data=0x" & to_hstring(data)
      severity failure;
  end procedure axi4lite_write_single;

  procedure axi4lite_read_single(
    signal clock             : in  std_logic;
    constant address         : in  std_logic_vector;
    signal readAddress       : out std_logic_vector;
    signal readAddressValid  : out std_logic;
    signal readAddressReady  : in  std_logic;
    signal readData          : in  std_logic_vector;
    signal readResponse      : in  std_logic_vector(1 downto 0);
    signal readValid         : in  std_logic;
    signal readReady         : out std_logic;
    variable observedData    : out std_logic_vector;
    constant timeoutCycles   : in  positive;
    constant transactionContext : in string
  ) is
    variable accepted : boolean := false;
  begin
    readAddress <= address;
    readAddressValid <= '1';
    for cycle in 1 to timeoutCycles loop
      wait until rising_edge(clock);
      if readAddressReady = '1' then
        accepted := true;
        readAddressValid <= '0';
        exit;
      end if;
    end loop;
    assert accepted
      report transactionContext & ": read AR timeout address=0x" & to_hstring(address)
      severity failure;

    readReady <= '1';
    for cycle in 1 to timeoutCycles loop
      wait until rising_edge(clock);
      if readValid = '1' then
        observedData := readData;
        assert readResponse = "00"
          report transactionContext & ": read R response error address=0x" &
            to_hstring(address) & " data=0x" & to_hstring(readData) &
            " response=0x" & to_hstring(readResponse)
          severity failure;
        readReady <= '0';
        return;
      end if;
    end loop;
    readReady <= '0';
    assert false
      report transactionContext & ": read R timeout address=0x" & to_hstring(address)
      severity failure;
  end procedure axi4lite_read_single;
end package body axi4lite_master_bfm;
