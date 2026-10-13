// Behavioral testbench for a generated register file whose ONLY register is a fieldless
// register-level `resetValue: $version` (core version 1.4.2, scheme major.minor.patch ->
// 0x010402). The design has no read-write or hardware register, so the register file has neither
// a regs_out nor a regs_in port. VERSION must read the literal through the bus and ignore every
// write; an unmapped address reads zero.
`timescale 1ns/1ps
module tb_version_only;
  import ver_core_pkg::*;

  logic clk = 0;
  logic rst;
  logic wr_en; logic [C_ADDR_WIDTH-1:0] wr_addr; logic [31:0] wr_data; logic [3:0] wr_strb;
  logic rd_en; logic [C_ADDR_WIDTH-1:0] rd_addr; logic [31:0] rd_data; logic rd_valid;

  integer errors = 0;

  ver_core_regs dut(.*);

  always #5 clk = ~clk;

  task automatic bus_write(input [C_ADDR_WIDTH-1:0] addr, input [31:0] data);
    @(posedge clk);
    wr_en = 1; wr_addr = addr; wr_data = data; wr_strb = 4'hF;
    @(posedge clk);
    wr_en = 0; wr_data = 0; wr_strb = 0;
  endtask

  task automatic bus_read(input [C_ADDR_WIDTH-1:0] addr, output [31:0] data);
    @(posedge clk);
    rd_en = 1; rd_addr = addr;
    @(posedge clk);
    rd_en = 0;
    #1 data = rd_data;
  endtask

  task automatic check(input [255:0] name, input [31:0] got, input [31:0] exp);
    if (got !== exp) begin
      $display("FAIL %0s got=0x%08x exp=0x%08x", name, got, exp);
      errors = errors + 1;
    end else begin
      $display("PASS %0s = 0x%08x", name, got);
    end
  endtask

  logic [31:0] rv;

  initial begin
    wr_en=0; wr_addr=0; wr_data=0; wr_strb=0; rd_en=0; rd_addr=0;
    rst = 1;
    repeat (3) @(posedge clk);
    @(posedge clk); rst = 0;

    bus_read('h00, rv);
    check("VERSION_READ", rv, 32'h00010402);

    bus_write('h00, 32'hFFFFFFFF);
    bus_read('h00, rv);
    check("VERSION_WRITE_IGNORED", rv, 32'h00010402);

    bus_write('h00, 32'h00000000);
    bus_read('h00, rv);
    check("VERSION_WRITE_ZERO_IGNORED", rv, 32'h00010402);

    bus_read('h04, rv);
    check("UNMAPPED_READ_ZERO", rv, 32'h00000000);

    $display("==== VERSION_ONLY SV DONE errors=%0d ====", errors);
    $finish;
  end
endmodule
