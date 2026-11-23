// Behavioral testbench for a generated register file whose VERSION register is built from
// `$version` constants (core version 1.4.2, scheme major.minor.patch -> 0x010402).
// Used for two designs that share the module name `ver_core_regs`:
//   * VERSION made of the fields MAJOR/MINOR/PATCH (all constant), and
//   * a fieldless register-level `resetValue: $version`.
// Both must read the literal through the bus, ignore every write, and leave the
// neighbouring read-write CTRL register working. The constant is not a regs_in
// member (the design has no regs_in port at all) and not part of regs_out.
`timescale 1ns/1ps
module tb_version_const;
  import ver_core_pkg::*;

  logic clk = 0;
  logic rst;
  logic wr_en; logic [C_ADDR_WIDTH-1:0] wr_addr; logic [31:0] wr_data; logic [3:0] wr_strb;
  logic rd_en; logic [C_ADDR_WIDTH-1:0] rd_addr; logic [31:0] rd_data; logic rd_valid;
  regs_sw2hw_t regs_out;

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

    // The neighbouring read-write register still works.
    bus_write('h04, 32'h00000001);
    bus_read('h04, rv);
    check("CTRL_RW", rv, 32'h00000001);
    check("CTRL_REGS_OUT", {31'b0, regs_out.ctrl.en}, 32'h00000001);

    bus_read('h00, rv);
    check("VERSION_AFTER_CTRL_WRITE", rv, 32'h00010402);

    $display("==== VERSION_CONST SV DONE errors=%0d ====", errors);
    $finish;
  end
endmodule
