// Behavioral testbench for the generated daq_controller_regs register file.
//
// Drives the standalone _regs module (no bus wrapper) directly and checks,
// by simulation, every access-type idiom documented in
// docs/tutorials/memory-mapped-registers.md: reset values, RW read/write,
// partial byte-strobe writes, RO status, W1C set/clear with same-cycle
// hardware-priority arbitration, self-clearing set/clear, and register-array
// addressing. Driven by src/test/integration/register-semantics.test.ts.
//
// `regs_in` (a wide packed struct) is driven ONLY through the synchronous
// shadow register below (`regs_in_next` -> `regs_in`), never by ad-hoc
// blocking assignment from the stimulus process. Icarus Verilog 13 has a
// scheduling quirk where directly blocking-assigning a struct-typed input
// port, after any prior `#delay` statement earlier in the same process,
// makes the DUT's always_ff miss the new value on the very next clock edge
// — a simulator artifact (VHDL/GHDL sees the same stimulus sequence
// correctly). A clocked shadow driver sidesteps it entirely and is good
// testbench discipline regardless of simulator.
`timescale 1ns/1ps
module tb_daq_regs;
  import daq_controller_pkg::*;

  logic clk = 0;
  logic rst;
  logic wr_en; logic [C_ADDR_WIDTH-1:0] wr_addr; logic [31:0] wr_data; logic [3:0] wr_strb;
  logic rd_en; logic [C_ADDR_WIDTH-1:0] rd_addr; logic [31:0] rd_data; logic rd_valid;
  regs_sw2hw_t regs_out;
  regs_hw2sw_t regs_in;
  regs_hw2sw_t regs_in_next;

  integer errors = 0;

  daq_controller_regs dut(.*);

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

    // CONTROL reset value: enable=0, mode=1, irq_en=0, prescaler=4 => 0x0000_0402
    bus_read('h00, rv);
    check("CONTROL_RESET", rv, 32'h0000_0402);

    // RW read/write round trip
    bus_write('h00, 32'h0000_FF07);
    bus_read('h00, rv);
    check("CONTROL_RW", rv, 32'h0000_FF07);

    // Partial byte-strobe write: only byte1 (prescaler bits[15:8]) changes to 0x22
    bus_write('h00, 32'h0000_2200, 4'b0010);
    bus_read('h00, rv);
    check("CONTROL_PARTIAL_STRB", rv, 32'h0000_2207);

    // RO STATUS driven by hardware
    regs_in_next.status.ready = 1'b1;
    regs_in_next.status.fifo_level = 8'h05;
    @(posedge clk); // let the shadow register commit to regs_in before reading
    bus_read('h04, rv);
    check("STATUS_RO", rv, 32'h0000_0501);

    // W1C INT_STATUS: hw sets ERROR via pulse, sw clears by writing 1
    regs_in_next.int_status_pulse.error_pulse = 1'b1;
    @(posedge clk); // regs_in <= 1 (shadow commit)
    @(posedge clk); // DUT samples regs_in=1 -> regs.int_status.error <= 1
    regs_in_next.int_status_pulse.error_pulse = 1'b0;
    #1;
    check("W1C_hw_set", regs_out.int_status.error, 1'b1);
    bus_read('h08, rv);
    check("W1C_read_sticky", rv, 32'h0000_0004);
    bus_write('h08, 32'h0000_0004);
    #1;
    check("W1C_sw_cleared", regs_out.int_status.error, 1'b0);

    // W1C same-cycle arbitration: hardware set beats a concurrent CPU clear-write
    regs_in_next.int_status_pulse.error_pulse = 1'b1;
    @(posedge clk); // shadow commits regs_in <= 1 (DUT hasn't sampled it yet this edge)
    wr_en = 1; wr_addr = 'h08; wr_data = 32'h0000_0004; wr_strb = 4'hF;
    @(posedge clk); // DUT samples regs_in.error_pulse=1 AND a same-cycle sw clear-write; hw wins
    wr_en = 0; wr_data = 0; wr_strb = 0;
    regs_in_next.int_status_pulse.error_pulse = 1'b0;
    #1;
    check("W1C_hw_priority_over_swclear", regs_out.int_status.error, 1'b1);
    bus_write('h08, 32'h0000_0004); // clean up

    // Self-clearing COMMAND: sw sets START by writing 1, hw clears via *_clear pulse
    bus_write('h0C, 32'h0000_0001);
    #1;
    check("SC_sw_set", regs_out.command.start, 1'b1);
    bus_read('h0C, rv);
    check("SC_read_is0(not readable)", rv, 32'h0000_0000);
    regs_in_next.command_clear.start_clear = 1'b1;
    @(posedge clk); // shadow commits
    @(posedge clk); // DUT consumes, regs.command.start <= 0
    regs_in_next.command_clear.start_clear = 1'b0;
    #1;
    check("SC_hw_cleared", regs_out.command.start, 1'b0);

    // Register array addressing: channel 0/1/2/3 CONFIG must not alias each other
    bus_write('h10, 32'h0000_0A01); // CHANNEL_0.CONFIG: gain=1, offset=0x0A
    bus_write('h20, 32'h0000_1402); // CHANNEL_1.CONFIG: gain=2, offset=0x14
    bus_write('h34, 32'h0000_1234); // CHANNEL_2.THRESHOLD
    bus_read('h10, rv);
    check("ARRAY_CH0_CONFIG", rv, 32'h0000_0A01);
    bus_read('h20, rv);
    check("ARRAY_CH1_CONFIG", rv, 32'h0000_1402);
    bus_read('h34, rv);
    check("ARRAY_CH2_THRESHOLD", rv, 32'h0000_1234);
    bus_read('h40, rv);
    check("ARRAY_CH3_CONFIG_UNTOUCHED", rv, 32'h0000_0000);

    // Change-of-state: LINK_STATUS.SPEED_CHANGED auto-sets when SPEED changes,
    // with no external pulse port -- the generator builds an internal shadow
    // register + comparator. The shadow register is synchronously reset to
    // SPEED's own reset value (ipcraft-vscode#33), so the first post-reset
    // read must show no spurious change-of-state event -- no defensive
    // write-1-to-clear needed here.
    bus_read('h50, rv);
    check("COS_initial", rv, 32'h0000_0000);
    regs_in_next.link_status_val.speed = 4'h5; // change SPEED from 0 to 5
    @(posedge clk); // regs_in <= 5 (shadow commit)
    @(posedge clk); // DUT's CoS comparator sees the mismatch -> SPEED_CHANGED set
    #1;
    bus_read('h50, rv);
    check("COS_auto_set", rv, 32'h0000_0105); // SPEED=5, SPEED_CHANGED=1
    bus_write('h50, 32'h0000_0100); // write 1 to clear SPEED_CHANGED (bit 8)
    bus_read('h50, rv);
    check("COS_cleared", rv, 32'h0000_0005); // SPEED still 5, flag cleared

    // Write-only DIAG.SCRATCH: stores the value for hardware, reads back as 0
    bus_write('h54, 32'h0000_00AB);
    #1;
    check("WO_regs_out", {24'b0, regs_out.diag.scratch}, 32'h0000_00AB);
    bus_read('h54, rv);
    check("WO_read_is0", rv, 32'h0000_0000);

    // Plain write-1-to-clear IRQ_LEGACY (not readable, unlike INT_STATUS's RW1C)
    regs_in_next.irq_legacy_pulse.legacy_irq_clr_pulse = 1'b1;
    @(posedge clk); // shadow commits regs_in <= 1
    @(posedge clk); // DUT samples 1 -> sets regs.irq_legacy.legacy_irq_clr <= 1
    regs_in_next.irq_legacy_pulse.legacy_irq_clr_pulse = 1'b0;
    #1;
    check("W1C_plain_hw_set", regs_out.irq_legacy.legacy_irq_clr, 1'b1);
    bus_read('h58, rv);
    check("W1C_plain_read_is0(not readable)", rv, 32'h0000_0000);
    bus_write('h58, 32'h0000_0001);
    #1;
    check("W1C_plain_sw_cleared", regs_out.irq_legacy.legacy_irq_clr, 1'b0);

    // Readable self-clearing BUSY_STATUS: sw sets, hw clears, readable while set
    bus_write('h5C, 32'h0000_0001);
    #1;
    check("RWSC_sw_set", regs_out.busy_status.busy, 1'b1);
    bus_read('h5C, rv);
    check("RWSC_read_while_set", rv, 32'h0000_0001);
    regs_in_next.busy_status_clear.busy_clear = 1'b1;
    @(posedge clk); // shadow commits
    @(posedge clk); // DUT consumes, regs.busy_status.busy <= 0
    regs_in_next.busy_status_clear.busy_clear = 1'b0;
    #1;
    check("RWSC_hw_cleared", regs_out.busy_status.busy, 1'b0);
    bus_read('h5C, rv);
    check("RWSC_read_after_clear", rv, 32'h0000_0000);

    $display("==== DAQ SV DONE errors=%0d ====", errors);
    $finish;
  end
endmodule
