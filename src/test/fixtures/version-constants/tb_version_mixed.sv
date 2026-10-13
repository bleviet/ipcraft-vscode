// Behavioral testbench for a generated register file with a constant mixed into a register that
// also has a read-write and a hardware-driven read-only field (core version 1.4.2, scheme
// major.minor.patch):
//   IDENT (0x00): REV [31:24] = $version.major (constant 0x01), BUSY [7:4] read-only (hardware),
//                 ENABLE [0] read-write, reset 1
// REV must read the literal, never be written, and must not appear in regs_out / regs_in; BUSY
// keeps reading the live regs_in.ident_val value.
//
// `regs_in` is driven ONLY through the synchronous shadow register below
// (`regs_in_next` -> `regs_in`), matching the other register-file testbenches.
`timescale 1ns/1ps
module tb_version_mixed;
  import ver_core_pkg::*;

  logic clk = 0;
  logic rst;
  logic wr_en; logic [C_ADDR_WIDTH-1:0] wr_addr; logic [31:0] wr_data; logic [3:0] wr_strb;
  logic rd_en; logic [C_ADDR_WIDTH-1:0] rd_addr; logic [31:0] rd_data; logic rd_valid;
  regs_sw2hw_t regs_out;
  regs_hw2sw_t regs_in;
  regs_hw2sw_t regs_in_next;

  integer errors = 0;

  ver_core_regs dut(.*);

  always #5 clk = ~clk;
  always_ff @(posedge clk) regs_in <= regs_in_next;

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
    regs_in_next = '0;
    rst = 1;
    repeat (3) @(posedge clk);
    @(posedge clk); rst = 0;

    // Reset: REV=0x01 (constant), BUSY=0 (hardware), ENABLE=1
    bus_read('h00, rv);
    check("IDENT_RESET", rv, 32'h01000001);

    // BUSY follows the hardware value; REV stays the constant.
    regs_in_next.ident_val.busy = 4'b1010;
    @(posedge clk); // shadow commit
    bus_read('h00, rv);
    check("IDENT_BUSY_LIVE", rv, 32'h010000A1);

    // Writing every bit changes only ENABLE (here: stays 1); REV and BUSY are immune.
    bus_write('h00, 32'hFFFFFFFF);
    bus_read('h00, rv);
    check("IDENT_WRITE_ALL_ONES", rv, 32'h010000A1);

    bus_write('h00, 32'h00000000);
    bus_read('h00, rv);
    check("IDENT_WRITE_ZERO", rv, 32'h010000A0);
    check("IDENT_REGS_OUT_ENABLE", {31'b0, regs_out.ident.enable}, 32'h00000000);

    $display("==== VERSION_MIXED SV DONE errors=%0d ====", errors);
    $finish;
  end
endmodule
