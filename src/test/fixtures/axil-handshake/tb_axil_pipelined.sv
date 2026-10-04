// Behavioral check of the generated AXI4-Lite slave with more than one
// transaction offered at a time, as an interconnect forwarding posted writes
// does: the next write's W beat arrives while the previous B is still pending
// (BREADY held low), and the next AR arrives while RVALID is still pending
// (RREADY held low). Every transaction must complete with the right data.
// DUT: examples/basic_peripheral (CONTROL @0x0 [3,0] RW, DATA_OUT @0x8 RW).
// Prints "PASS <check>" / "FAIL <check>" lines for axil-handshake.test.ts.
`timescale 1ns / 1ps
module tb_axil_pipelined;
  localparam int TIMEOUT = 200;  // cycles per phase

  logic clk = 1'b0;
  logic reset_n = 1'b0;
  always #5 clk = ~clk;

  logic [11:0] awaddr = '0;
  logic        awvalid = 1'b0;
  logic        awready;
  logic [31:0] wdata = '0;
  logic [3:0]  wstrb = 4'hF;
  logic        wvalid = 1'b0;
  logic        wready;
  logic [1:0]  bresp;
  logic        bvalid;
  logic        bready = 1'b0;
  logic [11:0] araddr = '0;
  logic        arvalid = 1'b0;
  logic        arready;
  logic [31:0] rdata;
  logic [1:0]  rresp;
  logic        rvalid;
  logic        rready = 1'b0;

  basic_peripheral dut (
    .clk(clk), .reset_n(reset_n),
    .s_axil_awaddr(awaddr), .s_axil_awvalid(awvalid), .s_axil_awready(awready), .s_axil_awprot(3'b000),
    .s_axil_wdata(wdata), .s_axil_wstrb(wstrb), .s_axil_wvalid(wvalid), .s_axil_wready(wready),
    .s_axil_bresp(bresp), .s_axil_bvalid(bvalid), .s_axil_bready(bready),
    .s_axil_araddr(araddr), .s_axil_arvalid(arvalid), .s_axil_arready(arready), .s_axil_arprot(3'b000),
    .s_axil_rdata(rdata), .s_axil_rresp(rresp), .s_axil_rvalid(rvalid), .s_axil_rready(rready),
    .o_data(), .o_irq()
  );

  // transaction t: DATA_OUT (0x8) first, then CONTROL (0x0)
  function automatic logic [11:0] addr_of(int t);
    return (t == 0) ? 12'h008 : 12'h000;
  endfunction
  function automatic logic [31:0] data_of(int t);
    return (t == 0) ? 32'hA5A55A5A : 32'h00000009;
  endfunction

  initial begin
    int cycles, b_count, r_count, ar_count;
    bit aw_done, w_done, ok;
    logic [31:0] rd [2];

    repeat (5) @(posedge clk);
    reset_n <= 1'b1;
    @(posedge clk);

    // Two writes back to back; BREADY low for 20 cycles, so the second W beat
    // is offered while the first write response is pending.
    ok = 1'b1; b_count = 0; cycles = 0;
    for (int t = 0; t < 2 && ok; t++) begin
      awaddr <= addr_of(t); wdata <= data_of(t);
      awvalid <= 1'b1; wvalid <= 1'b1;
      aw_done = 1'b0; w_done = 1'b0;
      while (!(aw_done && w_done) && ok) begin
        @(posedge clk);
        cycles++;
        if (awvalid && awready) begin aw_done = 1'b1; awvalid <= 1'b0; end
        if (wvalid && wready) begin w_done = 1'b1; wvalid <= 1'b0; end
        if (bvalid && bready) b_count++;
        bready <= (cycles >= 20);
        if (cycles > TIMEOUT) ok = 1'b0;
      end
    end
    awvalid <= 1'b0; wvalid <= 1'b0;
    while (ok && b_count < 2) begin
      @(posedge clk);
      cycles++;
      bready <= (cycles >= 20);
      if (bvalid && bready) b_count++;
      if (cycles > TIMEOUT) ok = 1'b0;
    end
    bready <= 1'b1;
    if (ok) $display("PASS writes_complete");
    else $display("FAIL writes_complete (%0d of 2 write responses)", b_count);

    // Two reads back to back; RREADY low for 20 cycles, so the second AR is
    // offered while the first read's RVALID is pending.
    ok = 1'b1; r_count = 0; ar_count = 0; cycles = 0;
    araddr <= addr_of(0);
    arvalid <= 1'b1;
    while (r_count < 2 && ok) begin
      @(posedge clk);
      cycles++;
      if (arvalid && arready) begin
        ar_count++;
        if (ar_count == 2) arvalid <= 1'b0;
        else araddr <= addr_of(1);
      end
      if (rvalid && rready) begin rd[r_count] = rdata; r_count++; end
      rready <= (cycles >= 20);
      if (cycles > TIMEOUT) ok = 1'b0;
    end
    arvalid <= 1'b0;
    if (ok) begin
      $display("PASS reads_complete");
      if (rd[0] == data_of(0)) $display("PASS read_data_out");
      else $display("FAIL read_data_out got 0x%08h", rd[0]);
      if (rd[1] == data_of(1)) $display("PASS read_control");
      else $display("FAIL read_control got 0x%08h", rd[1]);
    end else begin
      $display("FAIL reads_complete (%0d of 2 read responses)", r_count);
    end
    $finish;
  end
endmodule
