// Behavioral testbench for the generated mixed_and_multibit_regs register file.
//
// Regression coverage for:
//   - ipcraft-vscode#31: multi-bit W1C (EVENTS.FLAGS), multi-bit SC
//     (CMD.TRIGGERS) and multi-bit CoS (WATCH.CHANGED monitoring WATCH.VAL)
//     fields must compile on Icarus Verilog (the original bug: a
//     variable-indexed bit-select into a packed-struct member inside a for
//     loop) AND behave correctly under the whole-field masked-assignment
//     rewrite.
//   - ipcraft-vscode#32 item 2: CTRL_STATUS.BUSY is a read-only field mixed
//     into an otherwise read-write register with NO monitorChangeOf -- it
//     must read the live regs_in value, not a frozen reset value, and must
//     be immune to software writes targeting its bit range.
//
// `regs_in` is driven ONLY through the synchronous shadow register below
// (`regs_in_next` -> `regs_in`), matching the daq_controller testbench
// convention that sidesteps an Icarus Verilog scheduling quirk with
// struct-typed input ports.
`timescale 1ns/1ps
module tb_mixed_multibit;
  import mixed_and_multibit_pkg::*;

  logic clk = 0;
  logic rst;
  logic wr_en; logic [C_ADDR_WIDTH-1:0] wr_addr; logic [31:0] wr_data; logic [3:0] wr_strb;
  logic rd_en; logic [C_ADDR_WIDTH-1:0] rd_addr; logic [31:0] rd_data; logic rd_valid;
  regs_sw2hw_t regs_out;
  regs_hw2sw_t regs_in;
  regs_hw2sw_t regs_in_next;

  integer errors = 0;

  mixed_and_multibit_regs dut(.*);

  always #5 clk = ~clk;
  always_ff @(posedge clk) regs_in <= regs_in_next;

  task automatic bus_write(input [C_ADDR_WIDTH-1:0] addr, input [31:0] data, input [3:0] strb = 4'hF);
    @(posedge clk);
    wr_en = 1; wr_addr = addr; wr_data = data; wr_strb = strb;
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

    // CTRL_STATUS reset: EN=1, BUSY=0 (hardware-driven, currently 0)
    bus_read('h00, rv);
    check("CTRL_RESET", rv, 32'h00000001);

    // BUSY is hardware-driven and multi-bit: mixed register, no monitorChangeOf
    // (ipcraft-vscode#32 item 2 regression)
    regs_in_next.ctrl_status_val.busy = 4'b1011;
    @(posedge clk); // shadow commit
    bus_read('h00, rv);
    check("CTRL_BUSY_LIVE", rv, 32'h0000002D); // EN=1, BUSY=1011 at bits[5:2] -> 0x2D

    // A software write targeting the BUSY bit range must not corrupt the
    // hardware-driven read value: BUSY has no write path at all (RO), so this
    // write can only affect EN.
    bus_write('h00, 32'h0000003F);
    bus_read('h00, rv);
    check("CTRL_BUSY_IMMUNE_TO_WRITE", rv, 32'h0000002D); // EN=1 (unchanged), BUSY still 1011, bit1 is unmapped (always reads 0)

    // Multi-bit W1C: EVENTS.FLAGS. Hardware pulses bits 1 and 3.
    // This is the original ipcraft-vscode#31 reproduction: a variable-indexed
    // bit-select into regs.<reg>.<field>[i] inside a for loop, which Icarus
    // Verilog rejects at compile time.
    regs_in_next.events_pulse.flags_pulse = 4'b1010;
    @(posedge clk); // shadow commits
    @(posedge clk); // DUT samples pulse -> sets sticky bits
    regs_in_next.events_pulse.flags_pulse = 4'b0000;
    #1;
    check("W1C_multibit_hw_set", {28'b0, regs_out.events.flags}, 32'h0000000A);
    bus_read('h04, rv);
    check("W1C_multibit_read_sticky", rv, 32'h0000000A);

    // Software write-1-to-clear on bits 1 and 3 only.
    bus_write('h04, 32'h0000000A);
    #1;
    check("W1C_multibit_sw_cleared", {28'b0, regs_out.events.flags}, 32'h00000000);

    // Same-cycle hardware-set-vs-software-clear arbitration on a multi-bit
    // field: hardware wins.
    regs_in_next.events_pulse.flags_pulse = 4'b0001;
    @(posedge clk); // shadow commits, DUT hasn't sampled yet
    wr_en = 1; wr_addr = 'h04; wr_data = 32'h00000001; wr_strb = 4'hF;
    @(posedge clk); // DUT samples pulse=1 AND a same-cycle sw clear; hw wins
    wr_en = 0; wr_data = 0; wr_strb = 0;
    regs_in_next.events_pulse.flags_pulse = 4'b0000;
    #1;
    check("W1C_multibit_hw_priority", {28'b0, regs_out.events.flags}, 32'h00000001);
    bus_write('h04, 32'h0000000F); // clean up

    // Multi-bit SC: CMD.TRIGGERS. Software sets bits 0 and 2.
    bus_write('h08, 32'h00000005);
    #1;
    check("SC_multibit_sw_set", {28'b0, regs_out.cmd.triggers}, 32'h00000005);
    bus_read('h08, rv);
    check("SC_multibit_read_while_set", rv, 32'h00000005); // read-write-self-clearing is readable

    // Hardware clears only bit 0.
    regs_in_next.cmd_clear.triggers_clear = 4'b0001;
    @(posedge clk); // shadow commits
    @(posedge clk); // DUT consumes
    regs_in_next.cmd_clear.triggers_clear = 4'b0000;
    #1;
    check("SC_multibit_hw_partial_clear", {28'b0, regs_out.cmd.triggers}, 32'h00000004);

    // Multi-bit CoS: WATCH.VAL monitored by WATCH.CHANGED (4-bit sticky flag,
    // replicated across the width when the comparator fires). The shadow
    // register's explicit synchronous reset (ipcraft-vscode#33) means the
    // first post-reset read must show no spurious change-of-state event, even
    // with a multi-bit monitored value/flag -- no defensive write needed.
    bus_read('h0C, rv);
    check("COS_multibit_initial", rv, 32'h00000000);

    regs_in_next.watch_val.val = 4'hD; // change VAL from 0 to 0xD
    @(posedge clk); // shadow commits
    @(posedge clk); // DUT's CoS comparator sees the mismatch
    #1;
    bus_read('h0C, rv);
    check("COS_multibit_auto_set", rv, 32'h000000FD); // VAL=0xD, CHANGED=0xF (all bits set)

    // Partial write-1-to-clear on CHANGED (bits 5:4 only).
    bus_write('h0C, 32'h00000030);
    bus_read('h0C, rv);
    check("COS_multibit_partial_clear", rv, 32'h000000CD); // VAL=0xD, CHANGED=0xC (bits 7:6 remain)

    $display("==== MIXED_MULTIBIT SV DONE errors=%0d ====", errors);
    $finish;
  end
endmodule
