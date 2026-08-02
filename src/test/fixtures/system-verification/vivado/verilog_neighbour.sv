module verilog_neighbour (
  (* X_INTERFACE_INFO = "xilinx.com:signal:clock:1.0 clock CLK",
     X_INTERFACE_PARAMETER = "XIL_INTERFACENAME clock, ASSOCIATED_BUSIF S_AXI, ASSOCIATED_RESET reset_n, FREQ_HZ 100000000" *)
  input  logic        clock,
  (* X_INTERFACE_INFO = "xilinx.com:signal:reset:1.0 reset_n RST",
     X_INTERFACE_PARAMETER = "XIL_INTERFACENAME reset_n, POLARITY ACTIVE_LOW" *)
  input  logic        reset_n,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWADDR",
     X_INTERFACE_PARAMETER = "XIL_INTERFACENAME S_AXI, PROTOCOL AXI4LITE, DATA_WIDTH 32, ADDR_WIDTH 32, READ_WRITE_MODE READ_WRITE" *)
  input  logic [31:0] s_axi_awaddr,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWPROT" *)
  input  logic [2:0]  s_axi_awprot,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWVALID" *)
  input  logic        s_axi_awvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI AWREADY" *)
  output logic        s_axi_awready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WDATA" *)
  input  logic [31:0] s_axi_wdata,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WSTRB" *)
  input  logic [3:0]  s_axi_wstrb,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WVALID" *)
  input  logic        s_axi_wvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI WREADY" *)
  output logic        s_axi_wready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI BRESP" *)
  output logic [1:0]  s_axi_bresp,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI BVALID" *)
  output logic        s_axi_bvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI BREADY" *)
  input  logic        s_axi_bready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARADDR" *)
  input  logic [31:0] s_axi_araddr,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARPROT" *)
  input  logic [2:0]  s_axi_arprot,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARVALID" *)
  input  logic        s_axi_arvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI ARREADY" *)
  output logic        s_axi_arready,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RDATA" *)
  output logic [31:0] s_axi_rdata,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RRESP" *)
  output logic [1:0]  s_axi_rresp,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RVALID" *)
  output logic        s_axi_rvalid,
  (* X_INTERFACE_INFO = "xilinx.com:interface:aximm:1.0 S_AXI RREADY" *)
  input  logic        s_axi_rready
);
  logic aw_seen;
  logic write_seen;

  always_comb begin
    s_axi_awready = !aw_seen && !s_axi_bvalid;
    s_axi_wready = !write_seen && !s_axi_bvalid;
    s_axi_bresp = 2'b00;
    s_axi_arready = !s_axi_rvalid;
    s_axi_rresp = 2'b00;
  end

  always_ff @(posedge clock) begin
    if (!reset_n) begin
      aw_seen <= 1'b0;
      write_seen <= 1'b0;
      s_axi_bvalid <= 1'b0;
      s_axi_rvalid <= 1'b0;
      s_axi_rdata <= 32'h00000000;
    end else begin
      if (s_axi_bvalid && s_axi_bready) begin
        s_axi_bvalid <= 1'b0;
      end
      if (s_axi_awvalid && s_axi_awready) begin
        aw_seen <= 1'b1;
      end
      if (s_axi_wvalid && s_axi_wready) begin
        write_seen <= 1'b1;
      end
      if (!s_axi_bvalid && (aw_seen || (s_axi_awvalid && s_axi_awready)) &&
          (write_seen || (s_axi_wvalid && s_axi_wready))) begin
        aw_seen <= 1'b0;
        write_seen <= 1'b0;
        s_axi_bvalid <= 1'b1;
      end

      if (s_axi_rvalid && s_axi_rready) begin
        s_axi_rvalid <= 1'b0;
      end
      if (s_axi_arvalid && s_axi_arready) begin
        s_axi_rdata <= 32'h4E454947;
        s_axi_rvalid <= 1'b1;
      end
    end
  end

  logic unused;
  always_comb unused = ^{s_axi_awaddr, s_axi_awprot, s_axi_wdata, s_axi_wstrb,
                         s_axi_araddr, s_axi_arprot};
endmodule
