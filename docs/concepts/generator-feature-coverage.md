# Generator Feature Coverage

This matrix records what the generator verification suites prove about
generated register RTL. It is requirement coverage, not TypeScript line
coverage.

The distinction between the columns matters:

- **VHDL RTL** means GHDL analyzes, elaborates, and synthesizes the generated
  VHDL.
- **SystemVerilog RTL** means Icarus compiles and Verilator lints the generated
  SystemVerilog.
- **Behavioral simulation** means a testbench makes assertions about generated
  behavior. A generated cocotb test that only completes bus transactions is
  identified as a smoke test instead.
- **Vendor synthesis** means the generated project completes Quartus compile or
  Vivado out-of-context synthesis. This proves tool acceptance, not register
  semantics.
- **Hardware** requires a maintained on-board test result or log. A tutorial or
  manually run example without retained results is not counted.

`Yes` therefore means that the named evidence directly covers the row. `No`
names a current verification gap. All fixture-based checks generate both HDL
backends unless a cell says otherwise.

## Access-Type Semantics

The schema defines seven `AccessType` values. The dedicated
`register-semantics` testbench checks all seven against the generated
`daq_controller_regs` module with GHDL and Icarus.

| Access type | Fixture and asserted behavior | VHDL RTL | SystemVerilog RTL | Behavioral simulation | Quartus synthesis | Vivado synthesis | Hardware |
|---|---|---|---|---|---|---|---|
| `read-only` | `daq_controller`: live hardware value is readable | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `STATUS_RO` | Yes, `comprehensive_avalon` | Yes, `comprehensive_axi` and `comprehensive_avalon` | No |
| `write-only` | `daq_controller`: value reaches `regs_out` and reads as zero | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `WO_regs_out` and `WO_read_is0` | **No: no Quartus compile target contains this access type** | Yes, `comprehensive_axi` | No |
| `read-write` | `daq_controller`: write/read round trip | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `CONTROL_RW` | Yes, `comprehensive_avalon` | Yes, both comprehensive fixtures | No |
| `write-1-to-clear` | `daq_controller`: hardware set, reads as zero, software clear | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `W1C_plain_*` | Yes, `comprehensive_avalon` | Yes, both comprehensive fixtures | No |
| `read-write-1-to-clear` | `daq_controller`: hardware set, sticky read, software clear, and hardware-set priority over a same-cycle clear | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `W1C_*` | Yes, `comprehensive_avalon` | Yes, both comprehensive fixtures | No |
| `write-self-clearing` | `daq_controller`: software set, unreadable value, hardware clear | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `SC_*` | Yes, `comprehensive_avalon` | Yes, `comprehensive_avalon` | No |
| `read-write-self-clearing` | `daq_controller`: software set, readable while set, hardware clear | Yes, `hdl.test.ts` | Yes, Icarus compile and Verilator lint | Yes, `RWSC_*` | **No: no Quartus compile target contains this access type** | Yes, `comprehensive_axi` | No |

The `mixed-and-multibit` fixture adds assertion-based coverage for multi-bit
`read-write-1-to-clear` and `read-write-self-clearing` fields. It also covers a
hardware-driven multi-bit `read-only` field mixed into a software-writable
register.

## Generator Features

| Feature | Fixture(s) | VHDL RTL | SystemVerilog RTL | Behavioral simulation | Quartus synthesis | Vivado synthesis | Hardware |
|---|---|---|---|---|---|---|---|
| Register arrays | `daq_controller` nested `CHANNEL`; flat arrays in both comprehensive fixtures; nested groups in `comprehensive_axi` | Yes | Yes | Yes, distinct channel addresses and no aliasing in `ARRAY_*` | Partial: flat `SAMPLE_CNT` in `comprehensive_avalon`; **nested groups are not a Quartus synthesis target** | Yes, flat and nested arrays in `comprehensive_axi` | No |
| Byte-enable behavior | `daq_controller` partial `wr_strb`; AXI4-Lite `WSTRB`; Avalon-MM `byteenable` | Yes | Yes | Partial: both backends assert a partial register-file write in `CONTROL_PARTIAL_STRB`; **bus-wrapper tests use only full strobes** | Yes, AXI4-Lite `basic_peripheral` and Avalon-MM `comprehensive_avalon` synthesize; no partial-write assertion | Yes, both comprehensive wrappers synthesize; no partial-write assertion | No |
| Field-level reset | `daq_controller` `CONTROL` fields | Yes | Yes | Yes, `CONTROL_RESET` | Yes, `comprehensive_avalon` reset-valued fields | Yes, both comprehensive fixtures | No |
| Register-level reset | `comprehensive_axi.SCRATCH`; focused `registerLevelReset.test.ts` fixture | Yes | Yes | **No: template assertions exist, but no HDL testbench reads a register-level reset value** | **No: no Quartus compile target contains a register-level reset** | Yes, `comprehensive_axi` | No |
| `monitorChangeOf` | `daq_controller.LINK_STATUS`; multi-bit `mixed-and-multibit.WATCH`; both comprehensive fixtures | Yes | Yes | Yes, initial state, automatic set, clear, and multi-bit comparison | Yes, `comprehensive_avalon` | Yes, both comprehensive fixtures | No |
| W1C sticky/shadow storage | `daq_controller.INT_STATUS` and `IRQ_LEGACY`; `mixed-and-multibit.EVENTS` | Yes | Yes | Yes, hardware set, sticky read where applicable, software clear, multi-bit masking, and set-over-clear priority | Yes, `comprehensive_avalon` | Yes, both comprehensive fixtures | No |
| `monitorChangeOf` shadow comparator | `daq_controller.LINK_STATUS`; `mixed-and-multibit.WATCH` | Yes | Yes | Yes, reset without a spurious event, change detection, and clear | Yes, `comprehensive_avalon` | Yes, both comprehensive fixtures | No |
| AXI4-Lite register binding | `basic_peripheral`, `comprehensive_axi`, and `daq_controller` | Yes | Yes | Smoke only: generated cocotb performs full-word bus reads and writes; semantic assertions drive the register-file boundary | Yes, `basic_peripheral` | Yes, `comprehensive_axi` | No |
| Avalon-MM register binding | `comprehensive_avalon` | Yes | Yes | Smoke only: generated cocotb performs full-word bus reads and writes, including wait/valid handshakes when present | Yes, `comprehensive_avalon` | Yes, `comprehensive_avalon` | No |
| VHDL backend | Every template and example fixture | GHDL analyze, elaborate, and `--synth` | Not applicable | GHDL runs generated cocotb tests plus the two assertion-based register testbenches | Quartus compiles representative VHDL projects | Vivado synthesizes representative VHDL projects | No |
| SystemVerilog backend | Every template and example fixture | Not applicable | Icarus compile and Verilator lint | Icarus runs generated cocotb tests plus the two assertion-based register testbenches | Quartus compiles representative SystemVerilog projects | Vivado synthesizes representative SystemVerilog projects | No |

## Known Verification Gaps

The matrix deliberately leaves these gaps visible:

- No maintained hardware test result is linked to the generator suite. The
  [DE10-Nano case study](../tutorials/de10-nano-case-study.md) describes a
  manual workflow, but it is not an on-board regression gate and does not
  preserve per-feature results.
- Quartus synthesis does not currently cover `write-only`,
  `read-write-self-clearing`, register-level reset, or nested register groups.
- Register-level reset is checked in generated text and by Vivado synthesis,
  but not by an assertion-based HDL simulation.
- Partial byte enables are asserted only at the generated register-file
  boundary. AXI4-Lite `WSTRB` and Avalon-MM `byteenable` are synthesized, but
  neither wrapper has an assertion-based partial-write test.
- Generated cocotb tests exercise both bus bindings, but they do not compare
  read data with expected values and always use full byte strobes. They are bus
  transaction smoke tests, not evidence for access-type semantics.
- Vendor synthesis proves that a representative project is accepted by the
  tool. It does not prove reset values, readback policy, W1C/SC arbitration,
  `monitorChangeOf`, array address isolation, or byte-enable behavior.

## Evidence Map

| Evidence | Scope |
|---|---|
| `src/test/integration/hdl.test.ts` | Compile and synthesis elaboration for every generated VHDL fixture; compile and lint for every generated SystemVerilog fixture |
| `src/test/integration/register-semantics.test.ts` | Assertion-based GHDL and Icarus checks for all seven access types, reset, partial strobes, arrays, and single-bit `monitorChangeOf` |
| `src/test/integration/mixed-and-multibit.test.ts` | Assertion-based GHDL and Icarus checks for multi-bit W1C, self-clearing, `monitorChangeOf`, and mixed RO/RW registers |
| `src/test/integration/testbench.test.ts` | Generated cocotb bus-transaction smoke tests for both HDL backends and both memory-mapped bus bindings |
| `src/test/integration/quartus.test.ts` | Quartus project creation for generated Altera artifacts and compile for the named representative targets |
| `src/test/integration/vivado.test.ts` | Vivado IP integrity/block-design checks and out-of-context synthesis for the named representative targets |
| `src/test/suite/generator/registerLevelReset.test.ts` | Focused generated-text checks for register-level reset in both HDL backends |
| `ipcraft-spec/examples/daq_controller/` | Main assertion-based register-semantics fixture |
| `ipcraft-spec/examples/comprehensive_axi/` | AXI4-Lite, all access types except `write-self-clearing`, register-level reset, flat arrays, and nested groups |
| `ipcraft-spec/examples/comprehensive_avalon/` | Avalon-MM, `write-self-clearing`, flat arrays, byte enable, and `monitorChangeOf` |

The suite implementation and commands are described in
[How EDA integration tests work](eda-integration-tests.md) and
[Running the EDA integration tests](../how-to/run-eda-integration-tests.md).
