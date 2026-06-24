# Using Arithmetic Functions in Port Widths

How to derive a port width from a generic using predefined arithmetic functions
(for example, sizing a FIFO read pointer from the FIFO depth).

A port `width` may be a literal integer, a parameter name, or an arithmetic
expression. Expressions may use the following predefined functions:

| Function | Meaning | Example | Result (defaults) |
|---|---|---|---|
| `clog2(x)` | Ceiling of log2 — the bits needed to index `x` items (matches SystemVerilog `$clog2`) | `clog2(FIFO_DEPTH)` with `FIFO_DEPTH=1024` | `10` |
| `log2(x)` | Floor of log2 | `log2(8)` | `3` |
| `ceil(x)` | Round up | `ceil(DATA_WIDTH/8)` with `DATA_WIDTH=33` | `5` |
| `floor(x)` | Round down | `floor(DATA_WIDTH/8)` | `4` |
| `abs(x)` | Absolute value | `abs(A-B)` | — |
| `min(a, b)` | Smaller of two values | `min(A, B)` | — |
| `max(a, b)` | Larger of two values | `max(A, B)` | — |

Standard arithmetic (`+ - * /`), parentheses, and nesting
(`clog2(max(A, B))`) are also supported. Function names are matched
case-insensitively and stored in canonical lowercase.

---

## Example

A FIFO whose pointer width tracks its depth:

```yaml
parameters:
  - name: FIFO_DEPTH
    dataType: integer
    value: 1024
    description: Depth of the internal FIFO in words
ports:
  - name: fifo_rd_ptr
    direction: out
    width: clog2(FIFO_DEPTH)
    description: FIFO read pointer, width derived from FIFO_DEPTH
```

Changing `FIFO_DEPTH` automatically resizes `fifo_rd_ptr` — there is no separate
address-width parameter to keep in sync.

## What gets generated

The expression is translated into each target dialect:

| Target | Output for `clog2(FIFO_DEPTH)` |
|---|---|
| VHDL | `std_logic_vector((integer(ceil(log2(real(FIFO_DEPTH)))))-1 downto 0)`, with `use ieee.math_real.all;` added to the entity context clause |
| SystemVerilog | `logic [($clog2(FIFO_DEPTH))-1:0]` |
| Altera Platform Designer (`_hw.tcl`) | `[expr int(ceil(log([get_parameter_value FIFO_DEPTH])/log(2)))]` in the `elaborate` proc |
| Vivado IP-XACT (`component.xml`) | `spirit:dependency="(ceiling(log(2, spirit:decode(id('MODELPARAM_VALUE.FIFO_DEPTH')))) - 1)"` |

## Notes and limitations

- **Constant expressions fold to a literal.** `width: clog2(8)` becomes a plain
  `3`-bit port — it is not parameterized, so no function appears in the
  generated HDL.
- **`clog2(0)` is rejected** (mathematically undefined); the width falls back to
  the default rather than emitting a 0-bit port. `clog2(1)` is `0`, matching
  SystemVerilog `$clog2`.
- **`min`/`max` are not emitted to IP-XACT.** Vivado's XPATH dialect has no
  two-scalar `min`/`max`, so a Vivado `component.xml` falls back to the resolved
  literal width for those; `min`/`max` still work in VHDL, SystemVerilog, and
  Tcl.
- **`log2` (floor) has no SystemVerilog built-in** and is currently
  numeric-eval-only for SystemVerilog. Prefer `clog2` for address/index widths.
- The VHDL `ieee.math_real` functions are synthesizable here because they are
  applied to constant generics (the expected use case) in Vivado and Quartus.
