library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity axi4lite_slave_model is
  port (
    clock              : in  std_logic;
    resetN             : in  std_logic;
    awAddress          : in  std_logic_vector(31 downto 0);
    awValid            : in  std_logic;
    awReady            : out std_logic;
    writeData          : in  std_logic_vector(31 downto 0);
    writeStrobe        : in  std_logic_vector(3 downto 0);
    writeValid         : in  std_logic;
    writeReady         : out std_logic;
    writeResponse      : out std_logic_vector(1 downto 0);
    writeResponseValid : out std_logic;
    writeResponseReady : in  std_logic;
    readAddress        : in  std_logic_vector(31 downto 0);
    readAddressValid   : in  std_logic;
    readAddressReady   : out std_logic;
    readData           : out std_logic_vector(31 downto 0);
    readResponse       : out std_logic_vector(1 downto 0);
    readValid          : out std_logic;
    readReady          : in  std_logic;
    awAcceptCount      : out natural;
    writeAcceptCount   : out natural;
    readAcceptCount    : out natural;
    lastWriteStrobe    : out std_logic_vector(3 downto 0)
  );
end entity axi4lite_slave_model;

architecture behavioral of axi4lite_slave_model is
  type word_array is array (0 to 3) of std_logic_vector(31 downto 0);
  signal words : word_array := (
    x"10203040",
    x"50607080",
    x"90A0B0C0",
    x"D0E0F000"
  );

  signal capturedAwAddress : std_logic_vector(31 downto 0) := (others => '0');
  signal capturedWriteData : std_logic_vector(31 downto 0) := (others => '0');
  signal capturedStrobe    : std_logic_vector(3 downto 0) := (others => '0');
  signal awCaptured        : std_logic := '0';
  signal writeCaptured     : std_logic := '0';
  signal bValidInternal    : std_logic := '0';
  signal rValidInternal    : std_logic := '0';
  signal awCountInternal   : natural := 0;
  signal writeCountInternal : natural := 0;
  signal readCountInternal : natural := 0;

  function response_for(address : std_logic_vector(31 downto 0))
    return std_logic_vector is
  begin
    if address = x"00000020" then
      return "10";
    elsif address = x"00000024" then
      return "11";
    end if;
    return "00";
  end function response_for;

  function word_index(address : std_logic_vector(31 downto 0)) return natural is
  begin
    return to_integer(unsigned(address(3 downto 2)));
  end function word_index;
begin
  -- W is deliberately accepted before AW. This proves the BFM keeps the two
  -- independent channels asserted until each has completed its own handshake.
  writeReady <= '1' when resetN = '1' and writeCaptured = '0' and bValidInternal = '0' else '0';
  awReady <= '1' when resetN = '1' and awCaptured = '0' and writeCaptured = '1' and
    bValidInternal = '0' and awAddress /= x"00000030" else '0';
  readAddressReady <= '1' when resetN = '1' and rValidInternal = '0' and
    readAddress /= x"00000034" else '0';

  writeResponseValid <= bValidInternal;
  readValid <= rValidInternal;
  awAcceptCount <= awCountInternal;
  writeAcceptCount <= writeCountInternal;
  readAcceptCount <= readCountInternal;

  process (clock)
    variable nextWord : std_logic_vector(31 downto 0);
  begin
    if rising_edge(clock) then
      if resetN = '0' then
        capturedAwAddress <= (others => '0');
        capturedWriteData <= (others => '0');
        capturedStrobe <= (others => '0');
        awCaptured <= '0';
        writeCaptured <= '0';
        bValidInternal <= '0';
        rValidInternal <= '0';
        writeResponse <= "00";
        readResponse <= "00";
        readData <= (others => '0');
        awCountInternal <= 0;
        writeCountInternal <= 0;
        readCountInternal <= 0;
        lastWriteStrobe <= (others => '0');
      else
        assert not (readAddressValid = '1' and
          (awValid = '1' or writeValid = '1' or bValidInternal = '1'))
          report "parallel read/write traffic is outside this AXI4-Lite fixture"
          severity failure;

        if writeValid = '1' and writeReady = '1' then
          capturedWriteData <= writeData;
          capturedStrobe <= writeStrobe;
          writeCaptured <= '1';
        end if;

        if awValid = '1' and awReady = '1' then
          capturedAwAddress <= awAddress;
          awCaptured <= '1';
          awCountInternal <= awCountInternal + 1;
        end if;

        if awCaptured = '1' and writeCaptured = '1' and bValidInternal = '0' then
          nextWord := words(word_index(capturedAwAddress));
          for byteIndex in 0 to 3 loop
            if capturedStrobe(byteIndex) = '1' then
              nextWord((byteIndex * 8) + 7 downto byteIndex * 8) :=
                capturedWriteData((byteIndex * 8) + 7 downto byteIndex * 8);
            end if;
          end loop;
          words(word_index(capturedAwAddress)) <= nextWord;
          writeResponse <= response_for(capturedAwAddress);
          bValidInternal <= '1';
          writeCountInternal <= writeCountInternal + 1;
          lastWriteStrobe <= capturedStrobe;
        elsif bValidInternal = '1' and writeResponseReady = '1' then
          bValidInternal <= '0';
          awCaptured <= '0';
          writeCaptured <= '0';
        end if;

        if readAddressValid = '1' and readAddressReady = '1' then
          readData <= words(word_index(readAddress));
          readResponse <= response_for(readAddress);
          rValidInternal <= '1';
          readCountInternal <= readCountInternal + 1;
        elsif rValidInternal = '1' and readReady = '1' then
          rValidInternal <= '0';
        end if;
      end if;
    end if;
  end process;
end architecture behavioral;
