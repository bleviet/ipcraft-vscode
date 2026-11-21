module top (input clk, input rst_n, output [7:0] p0, output [15:0] p1,
  output s0_waitrequest, output [31:0] s0_readdata, output s0_readdatavalid,
  input [31:0] s0_writedata, input [15:0] s0_address, input s0_write, input s0_read, input [3:0] s0_byteenable);
  reg [7:0] glue;
  always @(posedge clk) glue <= glue + 1'b1;
  sys u0 (.clk_clk(clk), .reset_reset_n(rst_n), .pio0_export(p0), .pio1_export(p1),
    .s0_waitrequest(s0_waitrequest), .s0_readdata(s0_readdata), .s0_readdatavalid(s0_readdatavalid),
    .s0_burstcount(1'b1), .s0_writedata(s0_writedata ^ {24'b0, glue}), .s0_address(s0_address), .s0_write(s0_write),
    .s0_read(s0_read), .s0_byteenable(s0_byteenable), .s0_debugaccess(1'b0));
endmodule
