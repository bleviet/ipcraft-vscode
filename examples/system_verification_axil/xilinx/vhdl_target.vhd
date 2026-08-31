library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity vhdl_target is
  port (
    clock         : in  std_logic;
    reset_n       : in  std_logic;
    s_axi_awaddr  : in  std_logic_vector(31 downto 0);
    s_axi_awprot  : in  std_logic_vector(2 downto 0);
    s_axi_awvalid : in  std_logic;
    s_axi_awready : out std_logic;
    s_axi_wdata   : in  std_logic_vector(31 downto 0);
    s_axi_wstrb   : in  std_logic_vector(3 downto 0);
    s_axi_wvalid  : in  std_logic;
    s_axi_wready  : out std_logic;
    s_axi_bresp   : out std_logic_vector(1 downto 0);
    s_axi_bvalid  : out std_logic;
    s_axi_bready  : in  std_logic;
    s_axi_araddr  : in  std_logic_vector(31 downto 0);
    s_axi_arprot  : in  std_logic_vector(2 downto 0);
    s_axi_arvalid : in  std_logic;
    s_axi_arready : out std_logic;
    s_axi_rdata   : out std_logic_vector(31 downto 0);
    s_axi_rresp   : out std_logic_vector(1 downto 0);
    s_axi_rvalid  : out std_logic;
    s_axi_rready  : in  std_logic
  );

  attribute X_INTERFACE_INFO : string;
  attribute X_INTERFACE_PARAMETER : string;
  attribute X_INTERFACE_INFO of clock : signal is "xilinx.com:signal:clock:1.0 clock CLK";
  attribute X_INTERFACE_PARAMETER of clock : signal is
    "XIL_INTERFACENAME clock, ASSOCIATED_BUSIF S_AXI, ASSOCIATED_RESET reset_n, FREQ_HZ 100000000";
  attribute X_INTERFACE_INFO of reset_n : signal is "xilinx.com:signal:reset:1.0 reset_n RST";
  attribute X_INTERFACE_PARAMETER of reset_n : signal is
    "XIL_INTERFACENAME reset_n, POLARITY ACTIVE_LOW";
  attribute X_INTERFACE_INFO of s_axi_awaddr : signal is "xilinx.com:interface:aximm:1.0 S_AXI AWADDR";
  attribute X_INTERFACE_PARAMETER of s_axi_awaddr : signal is
    "XIL_INTERFACENAME S_AXI, PROTOCOL AXI4LITE, DATA_WIDTH 32, ADDR_WIDTH 32, READ_WRITE_MODE READ_WRITE";
  attribute X_INTERFACE_INFO of s_axi_awprot : signal is "xilinx.com:interface:aximm:1.0 S_AXI AWPROT";
  attribute X_INTERFACE_INFO of s_axi_awvalid : signal is "xilinx.com:interface:aximm:1.0 S_AXI AWVALID";
  attribute X_INTERFACE_INFO of s_axi_awready : signal is "xilinx.com:interface:aximm:1.0 S_AXI AWREADY";
  attribute X_INTERFACE_INFO of s_axi_wdata : signal is "xilinx.com:interface:aximm:1.0 S_AXI WDATA";
  attribute X_INTERFACE_INFO of s_axi_wstrb : signal is "xilinx.com:interface:aximm:1.0 S_AXI WSTRB";
  attribute X_INTERFACE_INFO of s_axi_wvalid : signal is "xilinx.com:interface:aximm:1.0 S_AXI WVALID";
  attribute X_INTERFACE_INFO of s_axi_wready : signal is "xilinx.com:interface:aximm:1.0 S_AXI WREADY";
  attribute X_INTERFACE_INFO of s_axi_bresp : signal is "xilinx.com:interface:aximm:1.0 S_AXI BRESP";
  attribute X_INTERFACE_INFO of s_axi_bvalid : signal is "xilinx.com:interface:aximm:1.0 S_AXI BVALID";
  attribute X_INTERFACE_INFO of s_axi_bready : signal is "xilinx.com:interface:aximm:1.0 S_AXI BREADY";
  attribute X_INTERFACE_INFO of s_axi_araddr : signal is "xilinx.com:interface:aximm:1.0 S_AXI ARADDR";
  attribute X_INTERFACE_INFO of s_axi_arprot : signal is "xilinx.com:interface:aximm:1.0 S_AXI ARPROT";
  attribute X_INTERFACE_INFO of s_axi_arvalid : signal is "xilinx.com:interface:aximm:1.0 S_AXI ARVALID";
  attribute X_INTERFACE_INFO of s_axi_arready : signal is "xilinx.com:interface:aximm:1.0 S_AXI ARREADY";
  attribute X_INTERFACE_INFO of s_axi_rdata : signal is "xilinx.com:interface:aximm:1.0 S_AXI RDATA";
  attribute X_INTERFACE_INFO of s_axi_rresp : signal is "xilinx.com:interface:aximm:1.0 S_AXI RRESP";
  attribute X_INTERFACE_INFO of s_axi_rvalid : signal is "xilinx.com:interface:aximm:1.0 S_AXI RVALID";
  attribute X_INTERFACE_INFO of s_axi_rready : signal is "xilinx.com:interface:aximm:1.0 S_AXI RREADY";
end entity vhdl_target;

architecture rtl of vhdl_target is
  signal controlRegister : std_logic_vector(31 downto 0) := (others => '0');
  signal capturedAwAddress : std_logic_vector(31 downto 0) := (others => '0');
  signal capturedWriteData : std_logic_vector(31 downto 0) := (others => '0');
  signal capturedWriteStrobe : std_logic_vector(3 downto 0) := (others => '0');
  signal awCaptured : std_logic := '0';
  signal writeCaptured : std_logic := '0';
  signal writeResponseValid : std_logic := '0';
  signal readResponseValid : std_logic := '0';
  signal awReadyInternal : std_logic;
  signal writeReadyInternal : std_logic;
  signal readAddressReadyInternal : std_logic;
begin
  awReadyInternal <= '1' when awCaptured = '0' and writeResponseValid = '0' else '0';
  writeReadyInternal <= '1' when writeCaptured = '0' and writeResponseValid = '0' else '0';
  readAddressReadyInternal <= not readResponseValid;
  s_axi_awready <= awReadyInternal;
  s_axi_wready <= writeReadyInternal;
  s_axi_bresp <= "00";
  s_axi_bvalid <= writeResponseValid;
  s_axi_arready <= readAddressReadyInternal;
  s_axi_rresp <= "00";
  s_axi_rvalid <= readResponseValid;

  process (clock)
    variable haveAw : std_logic;
    variable haveWrite : std_logic;
    variable writeAddress : std_logic_vector(31 downto 0);
    variable writeValue : std_logic_vector(31 downto 0);
    variable writeStrobe : std_logic_vector(3 downto 0);
    variable nextControl : std_logic_vector(31 downto 0);
  begin
    if rising_edge(clock) then
      if reset_n = '0' then
        controlRegister <= (others => '0');
        capturedAwAddress <= (others => '0');
        capturedWriteData <= (others => '0');
        capturedWriteStrobe <= (others => '0');
        awCaptured <= '0';
        writeCaptured <= '0';
        writeResponseValid <= '0';
        readResponseValid <= '0';
        s_axi_rdata <= (others => '0');
      else
        haveAw := awCaptured;
        haveWrite := writeCaptured;
        writeAddress := capturedAwAddress;
        writeValue := capturedWriteData;
        writeStrobe := capturedWriteStrobe;

        if writeResponseValid = '1' and s_axi_bready = '1' then
          writeResponseValid <= '0';
        end if;

        if s_axi_awvalid = '1' and awReadyInternal = '1' then
          haveAw := '1';
          writeAddress := s_axi_awaddr;
        end if;
        if s_axi_wvalid = '1' and writeReadyInternal = '1' then
          haveWrite := '1';
          writeValue := s_axi_wdata;
          writeStrobe := s_axi_wstrb;
        end if;

        if writeResponseValid = '0' and haveAw = '1' and haveWrite = '1' then
          if writeAddress(3 downto 2) = "01" then
            nextControl := controlRegister;
            for byteIndex in 0 to 3 loop
              if writeStrobe(byteIndex) = '1' then
                nextControl((byteIndex * 8) + 7 downto byteIndex * 8) :=
                  writeValue((byteIndex * 8) + 7 downto byteIndex * 8);
              end if;
            end loop;
            controlRegister <= nextControl;
          end if;
          haveAw := '0';
          haveWrite := '0';
          writeResponseValid <= '1';
        end if;

        awCaptured <= haveAw;
        writeCaptured <= haveWrite;
        capturedAwAddress <= writeAddress;
        capturedWriteData <= writeValue;
        capturedWriteStrobe <= writeStrobe;

        if readResponseValid = '1' and s_axi_rready = '1' then
          readResponseValid <= '0';
        end if;
        if s_axi_arvalid = '1' and readAddressReadyInternal = '1' then
          case s_axi_araddr(3 downto 2) is
            when "00" => s_axi_rdata <= x"00000001";
            when "01" => s_axi_rdata <= controlRegister;
            when "10" => s_axi_rdata <= x"49504352";
            when others => s_axi_rdata <= (others => '0');
          end case;
          readResponseValid <= '1';
        end if;
      end if;
    end if;
  end process;
end architecture rtl;
