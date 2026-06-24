# Plan: Predefined arithmetic functions for port widths

Issue: https://github.com/bleviet/ipcraft-vscode/issues/17
Title: `[PORTS Feature]: Allow having predefined functions for ports width`
Goal: When a port width is defined via generics, allow predefined arithmetic
functions such as `Log2`, `Ceil` in the width expression (e.g.
`width: clog2(DEPTH)`).

Status: **IMPLEMENTED** (Phases 1-4). The AST core, per-dialect serializers,
resolver/generator wiring, parser recognition, tests, schema description, and
the how-to (`docs/how-to/port-width-functions.md`) are in place. One deviation
from the original design: IP-XACT is emitted by the active TypeScript generator
`src/generator/VivadoComponentXmlGenerator.ts` (which uses `MODELPARAM_VALUE`),
not the `amd_component_xml.j2` template — that template is not wired into any
toolchain or scaffold pack and was left untouched.

## Current state (evidence)

The codebase is already expression-aware end to end. There is a single
canonical width-expression evaluator:

- `src/shared/evalWidthExpr.ts` — hand-rolled recursive-descent parser,
  no `eval`/`new Function` (CSP-safe for webview and extension host).
  Supports `+ - * /`, parentheses, unary minus, and parameter-name
  substitution. Rejects anything else by returning `undefined`.
  Allow-regex gate at `src/shared/evalWidthExpr.ts:27`:
  `^[0-9\s+\-*/().]+$`.

It is consumed in four places (and re-exported for the webview at
`src/webview/shared/utils/evalWidthExpr.ts:1`):

1. `src/generator/registerProcessor.ts:210-318` `getActiveBusPortsFromDefinition`
   — bus port width resolution. Compound-expression detection at
   `registerProcessor.ts:293` is a regex `/[+\-*/]/` used to decide
   parenthesization of `widthExpr` inside `std_logic_vector(...-1 downto 0)`
   and `logic[...-1:0]` (lines 294-296).
2. `src/generator/resolvers/bus.ts:96-145` `buildUserPorts` — user-port
   width resolution; Tcl translation via `toTclWidthExpression`
   (`bus.ts:31-48`) and `toTclWidth` (`bus.ts:50-62`), which wraps params as
   `[get_parameter_value NAME]` and compound forms as `[expr ...]`.
3. `src/generator/VivadoComponentXmlGenerator.ts:800-823` `resolveWidth` and
   `renderPorts` (`825-926`), which feeds `port.width_expr` into the template.
4. Webview live preview: `src/webview/shared/components/WidthField.tsx:82`
   and `src/webview/ipcore/components/canvas/CanvasInspector.tsx`
   (lines 2406, 2798, 3441).

Templates that embed width expressions:

- `src/generator/templates/amd_component_xml.j2:262-264` and `292-294` —
  emits `<spirit:left spirit:resolve="dependent"
  spirit:dependency="(spirit:decode(id('PARAM_VALUE.{{ port.width_expr }}')) - 1)">`.
  **This assumes `width_expr` is a bare param reference or plain arithmetic.**
  A function call breaks this assumption.
- `src/generator/templates/altera_hw_tcl.j2:149-160` — defers parameterized
  widths to an `elaborate {}` proc using `ep.tcl_width` and
  `get_parameter_value`.
- `core.sv.j2`, `top.sv.j2`, `core.vhdl.j2`, `top.vhdl.j2`,
  `bus_axil.sv.j2` — consume pre-baked `port.sv_type` / `port.type` strings
  built in `registerProcessor.ts:290-300`.

Schema: `ipcraft-spec/schemas/ip_core.schema.json` `$defs.Port.width`
(lines 824-875) is already `integer | string`. Same for `ConduitPort.width`
and `BusInterface.portWidthOverrides`. **No schema change is required** to
accept function expressions; they are just strings.

Parsers (reverse path, RTL -> YAML): `src/parser/VerilogParser.ts:340-362`
`extractWidth` only handles `PARAM-1:0` and `PARAM:0`; returns `undefined`
for anything else. `src/parser/VhdlParser.ts:273-323` `extractWidthFromType`
already captures compound forms like `AxiDataWidth_g/8`.

## Use cases in this project

These are real instances of the gap, found in the repo's own fixtures and
examples — not hypothetical scenarios. They are the concrete motivation for
shipping this feature.

- **FIFO read/write pointer or fill-level width from FIFO depth.** Three
  real fixtures declare a `FIFO_DEPTH` parameter with no port deriving its
  width from it — today the address/pointer width must be a second,
  independently maintained parameter that can silently drift out of sync:
  - `src/test/fixtures/cornercase-ipcore.yml:42-53` — `ADDR_WIDTH=12` and
    `FIFO_DEPTH=256` declared as unrelated siblings (`clog2(256)=8`, but
    `ADDR_WIDTH` is hand-set to 12).
  - `ipcraft-spec/examples/system_controller/system_controller.ip.yml:133-144`
    — same pattern: `ADDR_WIDTH=32`, `FIFO_DEPTH=1024` (`clog2(1024)=10`).
  - `ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.ip.yml:23-26`
    — `FIFO_DEPTH` parameter ("Internal buffer depth in words") with no port
    in the file deriving a width from it at all.
  - With this feature, a FIFO pointer/level port could be declared as
    `width: clog2(FIFO_DEPTH)` and stay correct automatically as
    `FIFO_DEPTH` changes — no second parameter to keep in sync.
- **Channel-select width from a channel count.**
  `ipcraft-spec/examples/multi_interface_accelerator/accelerator.ip.yml:75`
  declares `NUM_CHANNELS=4` with no corresponding select-line port. A
  `width: clog2(NUM_CHANNELS)` port (e.g. an active-channel index) becomes
  expressible without a hand-maintained constant.
- **FIFO fill-level status field sizing (related, out of scope).**
  `ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.mm.yml:77-80`
  hand-picks `FIFO_LEVEL` as bits `[15:4]` (12 bits) in a status register,
  with no link back to `FIFO_DEPTH=1024` (which needs `clog2(1024)+1 = 11`
  bits to represent depth-inclusive of "full"). This is a **memory-map
  register field**, not a port, so it stays out of scope per "Out of scope"
  below — called out here so a future ask for the same functions on
  register/field widths isn't a surprise.
- **Byte-enable/strobe width — the `ceil` edge case, not just `clog2`.**
  `src/generator/registerProcessor.ts:279-281` already derives WSTRB width
  as `DATA_WIDTH/8` via plain division + truncation
  (`src/test/fixtures/expr-ipcore.yml:21` exercises the identical pattern,
  `AxiDataWidth_g/8`). This works silently *only* because example data
  widths are byte-aligned (32, 64). The moment a non-byte-aligned
  `DATA_WIDTH` is used (e.g. 33), today's truncating division undercounts by
  one byte (`33/8 -> 4`, should be `5`). Once `ceil` ships, document
  `ceil(DATA_WIDTH/8)` as the forward-looking idiom for strobe widths
  (Phase 4 docs/example work); the existing truncating behavior is a latent
  rounding bug worth a separate follow-up issue.
- **AXI address width from register-map size (longer-term, out of scope for
  Phase 1-4).** `ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.ip.yml`
  and `ipcraft-spec/templates/axi_slave.ip.yml` hardcode `AWADDR`/`ARADDR`
  widths via `portWidthOverrides` (literal integers like 12/16/40) rather
  than deriving them from the addressable register-map span. A motivating
  case for `clog2`, but it requires cross-referencing `memoryMaps` size into
  the port resolver — noted here only as forward context.

## The core design challenge

The same width-expression string must be translatable into **four distinct
output dialects**, each with different function-name conventions and
availability:

| Dialect | Where | Function support |
|---|---|---|
| SystemVerilog | `port.sv_type` | `$clog2(x)` built-in. No `ceil`/`floor`/`log2` built-in. |
| VHDL | `port.type` | `ieee.math_real.all` provides `log2`, `ceil`, `floor`, `real`. `clog2(N)` serializes to `integer(ceil(log2(real(N))))`. Standard library, no custom function needed. |
| Tcl (`expr`) | `port.tcl_width` | `ceil`/`floor`/`log`/`pow` via `tcl::mathfunc`; no `log2`/`clog2` (must expand). |
| IP-XACT (`spirit:dependency`) | `amd_component_xml.j2` | XPATH functions (per Vivado UG1118): `ceiling`, `floor`, `log(base,num)`, `pow`, `abs`, `round`, `max`, `min`, `sum`. `clog2(N)` -> `ceiling(log(2, N))` (the doc's canonical example). Param refs wrapped as `spirit:decode(id('PARAM_VALUE.NAME'))`. |

Because the current code uses **string-level** substitution for Tcl and
**string embedding** for SV/VHDL/IP-XACT, adding functions cleanly requires
moving to an **AST**: parse once into a tree, evaluate numerically for
defaults, and serialize per dialect. This also fixes the brittle
regex-based compound detection and the allow-regex gate.

## Open decisions (need maintainer sign-off)

**Decision 1 — function semantics of `log2`.**
In hardware the dominant need is "address width = ceil(log2(N))" (the SV
`$clog2` idiom). A bare `log2` is ambiguous (floor vs ceil). Recommended:
ship **two** distinct functions to remove ambiguity:

- `clog2(x)` — ceiling of log2(x); maps to SV `$clog2`, the recommended
  width function. `clog2(1)=0`, `clog2(2)=1`, `clog2(3)=2`, `clog2(4)=2`.
- `log2(x)` — floor of log2(x) (exact when power of two).

Also include: `ceil`, `floor`, `abs`, `min(a,b)`, `max(a,b)`, `exp2`.

**Decision 2 — canonical casing.** The issue writes "Log2, Ceil". VHDL is
case-insensitive; SV is case-sensitive. Recommended: canonical
**lowercase** (`clog2`, `ceil`, ...), with **case-insensitive matching at
parse time** for ergonomics, then serialize to the dialect's required
spelling (`$clog2` in SV, `clog2` in VHDL, etc.). This keeps YAML friendly
without breaking SV.

**Decision 3 — function set for Phase 1.** Recommended minimal set:
`clog2`, `ceil`, `floor`, `abs`, `max`, `min`. Defer `exp2`/`pow` together
(`exp2(N) = pow(2,N)`; SV/VHDL have no synthesizable `pow` for bit-widths,
so both are equally hard — defer as a pair unless requested).

**Decision 4 — IP-XACT emission.** RESOLVED. Vivado UG1118 documents that
the IP packager supports XPATH functions in `spirit:dependency`
(`ceiling`, `floor`, `log(base,num)`, `pow`, `abs`, `round`, `max`, `min`).
`clog2(N)` maps to `ceiling(log(2, N))` — the doc's own example for a
`ceil_log2(max_count)` port. So function-based widths stay fully
parameterized in `component.xml`; no literal-fallback needed. Caveat:
Vivado does not support custom HDL functions on ports, but our generator
emits the XPATH form directly into `spirit:dependency`, which is exactly
the recommended mechanism. **`max`/`min` omitted from IP-XACT dialect**
(UG1118 lists them as `max(node-set)`/`min(node-set)` — no two-scalar form);
the serializer returns a sentinel and the resolver falls back to a literal
default width or warns. `max`/`min` remain available in SV/VHDL/Tcl.

**Decision 5 — `log2` (floor) and edge values.**
- `log2` (floor) has **no SystemVerilog built-in** (only `$clog2` exists).
  Ship `log2` as numeric-eval-only; its SV/VHDL serialization is deferred
  until a `localparam`/macro helper is added (or omit `log2` from the
  Phase-1 set entirely). `clog2` is the recommended width function.
- `clog2(0)`: mathematically undefined. Define as `undefined` (evaluator
  returns `undefined` -> caller falls back to default), NOT 0, to surface
  the error rather than emit a 0-bit port silently.
- `clog2(1) = 0` (matches SV `$clog2`). Document that a 1-deep structure
  yields a 0-bit address; some tools handle this oddly — flagged in docs.

## Proposed architecture

### A. AST-based expression core (new)

Introduce a small parser module that produces an AST, replacing the
inline parser inside `evalWidthExpr.ts`. Nodes:

```
Number(value)
ParamRef(name)
Unary(op, operand)
Binary(op, left, right)
Call(fnName, args[])
```

Two operations on the AST:

- `evaluate(ast, paramDefaults): number | undefined` — JS evaluation.
  Function table: `clog2`, `log2`, `ceil`, `floor`, `abs`, `min`, `max`.
  Define `clog2(n)` = `n <= 1 ? 0 : Math.ceil(Math.log2(n))`
  with the special case `clog2(0) -> undefined` (per Decision 5);
  `clog2(1)=0`.
- `serialize(ast, dialect, ctx): { code: string; usedFunction: boolean }` —
  dialect emitters. The returned `ctx.usedFunction` flags whether any
  `Call` node was emitted, so the resolver can inject
  `use ieee.math_real.all;` in one pass (no separate
  `containsFunctionCall` walk).
  - **Constant-folding:** if `evaluate(ast, {})` returns a number (no
    unresolved `ParamRef` anywhere in the tree), `serialize` emits that
    literal directly in every dialect — `clog2(8)` becomes `3`, not
    `$clog2(8)` / `ceiling(log(2,8))`. This makes `is_parameterized=false`
    for constant functions and routes them through the existing static
    `port.width - 1` template branch.
  - `systemverilog` — `clog2` -> `$clog2` (IEEE 1800-2012; supported by
    Vivado and Quartus synthesis — add a target-dependency note in the
    serializer). **`log2` (floor) has no SV built-in**: defer its SV
    emission unless a `localparam`/macro helper is added; for Phase 1-2,
    `log2` is numeric-eval-only and errors at SV serialization.
  - `vhdl` — `clog2(x)` -> `integer(ceil(log2(real(x))))` via
    `ieee.math_real.all`; `log2(x)` -> `integer(floor(log2(real(x))))`;
    `ceil(x)` -> `integer(ceil(real(x)))`; `floor(x)` ->
    `integer(floor(real(x)))`. **Note:** `math_real` is a simulation
    library but synthesizable for constant generics (the expected use
    case here) in Vivado/Quartus — document this.
  - `tcl` — `clog2(x)` -> `int(ceil(log(x)/log(2)))` (Tcl `log` is natural
    log), params -> `[get_parameter_value NAME]`, wrap in `[expr ...]` when
    parameterized. Verify both Vivado and Quartus Tcl `expr` expose the
    same math functions (Phase 3).
  - `ipxact` — XPATH (Vivado UG1118). `clog2(x)` -> `ceiling(log(2, x))`;
    `log2(x)` -> `floor(log(2, x))`; `ceil`/`floor`/`abs`/`round` map
    verbatim. **`max`/`min` are OMITTED from the IP-XACT dialect** — UG1118
    documents them as `max(node-set)` / `min(node-set)`, which do not
    accept two scalar arguments; silently emitting `max(A,B)` would let
    Vivado reject packaging. The serializer returns an error/sentinel for
    `max`/`min` in IP-XACT so the resolver can fall back to a literal
    width or warn. Each `ParamRef` serializes recursively as
    `spirit:decode(id('PARAM_VALUE.NAME'))`.
  - `js` — for the webview preview path (reuses `evaluate`).

**Public API:** `src/shared/widthExprAst.ts` exports the node types,
`parse()`, `evaluate()`, `serialize()`, and `containsParamRef(ast)` for
direct consumption by tests and resolvers. `containsParamRef` returns true
iff any `ParamRef` exists at any depth (including inside `Call` args) —
this drives `is_parameterized`, so `clog2(8)` is not parameterized while
`clog2(DEPTH)` and `max(8, DATA_W)` are.

`evalWidthExpr(expr, defaults)` becomes a thin wrapper: parse -> evaluate.
Backward compatible; existing tests stay green.

The allow-regex gate at `evalWidthExpr.ts:27` is removed — the parser
itself rejects unknown identifiers/functions, which is stricter and
correct.

### B. Resolver integration

- `registerProcessor.ts` lines 267-300: replace regex compound detection
  (`/^[+\-*/]/`) with an AST-based parenthesization rule: parenthesize any
  top-level node that is **not a leaf** (`ast.type !== 'Number' &&
  ast.type !== 'ParamRef'`), i.e. include `Binary`, `Unary`, and `Call`.
  This is **conservative** — standard operator precedence already makes
  `expr-1` bind correctly for both arithmetic and bare function calls
  (function application binds tighter than `-`), so the parens are
  defensive, not correctness-critical — but a uniform non-leaf rule avoids
  edge cases across dialects. Keep emitting `width_expr` as the
  **original** user string so YAML round-trips unchanged; build HDL
  `type`/`sv_type` via `serialize(ast, 'vhdl'|'systemverilog')`.
- `bus.ts` `toTclWidthExpression`/`toTclWidth`: replace regex
  identifier-substitution with `serialize(ast, 'tcl')`. Keep the
  `[get_parameter_value X]` and `[expr ...]` wrapping behavior.
- `VivadoComponentXmlGenerator.ts` `resolveWidth`: unchanged (still calls
  `evalWidthExpr` for the numeric default). Add a new precomputed
  `port.width_expr_ipxact` field on the emitted `TemplatePort`: built by
  `serialize(ast, 'ipxact')` when `is_parameterized` is true, else
  `null`/omitted. **Invariant:** `width_expr_ipxact` is the WIDTH (not
  `width-1`) — the `- 1` subtraction stays in the template
  (`amd_component_xml.j2:263`), matching current bare-param behavior.
  The existing `{% if port.is_parameterized %}` gate (line 261) already
  guards access, so no Jinja null-rendering risk; define the contract as
  "set iff `is_parameterized`". Mirror the field in
  `src/generator/contract/templateContext.types.ts` (regenerate via
  `npm run generate-types` if the contract schema is updated, or extend
  the hand-written `UserPort`/`BusPort` interfaces).
- `buildUserPorts` (`bus.ts`): same AST path; the hardcoded `?? 32`
  fallback stays; also emit `width_expr_ipxact` for consistency.

### C. Templates

- `amd_component_xml.j2` lines 259-267 / 291-294: the current template
  wraps the whole `port.width_expr` in
  `spirit:decode(id('PARAM_VALUE.{{ port.width_expr }}'))`, which only
  works for a bare param name. Replace with a precomputed
  `port.width_expr_ipxact` field produced by `serialize(ast, 'ipxact')`
  (full XPATH, e.g. `ceiling(log(2, spirit:decode(id('PARAM_VALUE.DEPTH'))))`),
  and emit `spirit:dependency="({{ port.width_expr_ipxact }} - 1)"`. The
  resolver computes this field; no Jinja-side parsing. For non-function
  bare-param widths, `width_expr_ipxact` is just
  `spirit:decode(id('PARAM_VALUE.NAME'))`, preserving current behavior.
  **Off-by-one invariant:** `width_expr_ipxact` is the WIDTH; the
  `- 1` stays in the template (verified against `amd_component_xml.j2:263`).
- `altera_hw_tcl.j2` elaborate proc (lines 149-160): already uses
  `ep.tcl_width`; the AST Tcl serializer output drops in unchanged.
- SV/VHDL templates: no change to port lines — they consume
  `port.sv_type`/`port.type` which are now function-correct.
- **VHDL `math_real` context clause:** add `use ieee.math_real.all;`
  **in the entity context clause** (`core.vhdl.j2` lines 9-13, right after
  `use ieee.numeric_std.all;`) — conditionally, only when any port width
  uses a function. This is the correct visibility point because the
  expanded `integer(ceil(log2(real(...))))` expression is emitted in the
  **entity port declaration** (`core.vhdl.j2:43, 51`), so `math_real` must
  be visible at the entity (not the architecture declarative region). A
  `usedFunction` flag carried from `serialize()` drives the conditional
  injection in one pass. No custom `clog2` function declaration is needed.
  Apply the same conditional clause to `top.vhdl.j2`.

### D. Webview

Numeric preview needs no change — `WidthField.tsx:82` and
`CanvasInspector.tsx` call `evalWidthExpr`, which picks up function support
automatically; live preview of `clog2(DEPTH)` shows the resolved default.

**UX caveat (verified):** `WidthField.tsx:81,134` renders the **raw user
string** in the input field (e.g. `CLOG2(DEPTH)` is shown verbatim), while
`:220` shows the numeric `= N` preview. To avoid git-history noise and
divergent spellings, normalize function-name tokens to the canonical
lowercase form (`clog2`) on **save** — in the webview commit path
(`onSaveWithValue` / postMessage) or the `src/yamledit/` write-back, before
the YAML is persisted. Do not mutate the user's literal numbers or
parameter names; lowercase only recognized function identifiers.

### E. Parsers (optional, Phase 4)

- `VerilogParser.ts` `extractWidth`: extend to recognize
  `$clog2(PARAM)-1:0` and `$clog2(PARAM):0` -> width_expr `clog2(PARAM)`.
  Enables importing existing RTL that uses `$clog2`.
- `VhdlParser.ts` `extractWidthFromType`: already handles compound
  expressions; add function-call capture.

### F. Schema / docs

- No `ip_core.schema.json` type change required (`width` is already
  `integer | string`). **Do** update the `width` `description` text at all
  four sites (`Port.width`, `ConduitPort.width`, `BusInterface` user-port
  width, and the bus-port equivalent — currently "Port width in bits or
  parameter name" with no mention of functions) to list the supported
  functions (`clog2`, `ceil`, `floor`, `min`, `max`) and point at the "Use
  cases in this project" section above. This is a text-only change (no type
  change, so `npm run generate-types` is not required for it), low risk, and
  is exactly what a new IP author needs surfaced at the point of typing
  `width:` — do this unconditionally as part of Phase 4, not only "if schema
  text changes" for other reasons.
- Add a `docs/how-to/` entry and a worked example `.ip.yml` using
  `width: clog2(FIFO_DEPTH)`.
- Run `npm run generate-types` only if schema text changes — no type
  regeneration needed for the string-valued `width`.

## Phased rollout (de-risked)

**Phase 1 — Numeric resolution (core value, low risk; NOT released standalone).**
AST refactor of `evalWidthExpr`; implement `evaluate()` for `clog2`, `ceil`,
`floor`, `abs`, `min`, `max`. All four consumers now compute correct
**numeric default widths** for function expressions. Deliverable: live
preview and default widths correct; existing tests green; new unit tests
for functions. **Generation guard (verified necessary):** the current
`registerProcessor.ts:293-296` emits the raw `width_expr` into
`sv_type`/`type`, so `clog2(DEPTH)` would produce invalid SV
(`logic [clog2(DEPTH)-1:0]` — `clog2` is not a built-in, only `$clog2`).
Until Phase 2 serializers land, the scaffolder must **block or hard-error**
on any function-based width (detect via `containsCall(ast)`) with a message
pointing to the Phase 2 work. Do not release Phase 1 to users without
Phase 2, OR ship them together as one unit.

**Phase 2 — HDL + Tcl + IP-XACT serialization.**
Implement `serialize()` for all four dialects: `systemverilog` (`$clog2`),
`vhdl` (`integer(ceil(log2(real(x))))` via `math_real`), `tcl` (expansion),
`ipxact` (XPATH `ceiling(log(2, x))` with `spirit:decode(id('PARAM_VALUE.X'))`
param refs; `max`/`min` omitted with literal/warn fallback). Update
`registerProcessor.ts` and `bus.ts` to build
`type`/`sv_type`/`tcl_width`/`width_expr_ipxact` from the AST. Add the
conditional `use ieee.math_real.all;` clause to VHDL entity context.
Update `amd_component_xml.j2` to consume `port.width_expr_ipxact`. Remove
the Phase 1 generation guard. Deliverable: generated `core.sv`/`top.sv`
use `$clog2`; `core.vhdl`/`top.vhdl` use `math_real`; Altera Tcl
`elaborate` and Vivado `component.xml` `spirit:dependency` compute
correctly.

**Phase 3 — Validation.**
Verify Tcl `expr` math functions match across Vivado and Quartus. Run
end-to-end packaging in Vivado/Quartus on a `clog2(DEPTH)` port, including
an **IP-XACT round-trip**: generate `component.xml`, re-import into Vivado
IP Catalog, confirm the parameter-to-port-width dependency resolves at
elaboration. No new features.

**Phase 4 — Polish.**
Verilog/VHDL parser recognition of `$clog2`; docs + example; optional
`exp2`/`pow`.

## Test plan

- Extend `src/test/suite/shared/evalWidthExpr.test.ts`: add cases for
  `clog2(8)==3`, `clog2(1)==0`, `clog2(0)==undefined`, `ceil(DATA_W/8)`,
  `floor(...)`, `max(A,B)`, `min(A,B)`, nested `clog2(max(A,B))`, unknown
  function -> `undefined`, case-insensitivity (`CLOG2(8)`).
- **`containsParamRef` cases:** `clog2(8)` -> false (constant, folds to
  literal); `clog2(DEPTH)` -> true; **mixed args** `max(8, DATA_W)` ->
  true (one literal + one param). Assert `is_parameterized` follows.
- New `src/test/suite/shared/widthExprSerialize.test.ts` (or alongside):
  assert per-dialect serialization for each function, including
  `serialize(ast,'ipxact')` == `ceiling(log(2, spirit:decode(id('PARAM_VALUE.DEPTH'))))`
  for `clog2(DEPTH)`; assert `max`/`min` in `ipxact` returns the
  sentinel/fallback; assert constant-folding (`clog2(8)` serializes to
  `3`, not `$clog2(8)`).
- Extend `src/test/suite/generator/registerProcessor.test.ts`: add a port
  with `width: clog2(DEPTH)` and assert `sv_type`/`type`/`tcl_width`/
  `width_expr_ipxact` and `is_parameterized=true`; add a constant
  `width: clog2(8)` case asserting `is_parameterized=false` and static
  width `3`.
- Add a generator fixture test (`src/test/suite/generator/`) that runs the
  scaffolder on an `.ip.yml` using `clog2` and snapshots `core.sv` /
  `amd_component_xml` / `altera_hw_tcl` outputs; assert the VHDL output
  contains `use ieee.math_real.all;` only when a function width is used.
  Base this fixture on one of the grounded "Use cases in this project"
  examples above (e.g. a `FIFO_DEPTH` parameter with a pointer port set to
  `width: clog2(FIFO_DEPTH)`) rather than an arbitrary expression, so the
  fixture doubles as a regression guard for the motivating use case.
- **Phase 3 integration:** IP-XACT round-trip — generate `component.xml`,
  re-import into Vivado IP Catalog, confirm the param-to-port-width
  `spirit:dependency` resolves (manual/CI gate).
- Regression: all existing `evalWidthExpr` and `registerProcessor` tests
  must stay green (backward compatible).

## Files to touch (summary)

| File | Phase | Change |
|---|---|---|
| `src/shared/evalWidthExpr.ts` | 1 | AST parser + `evaluate()` + function table; keep public signature. |
| `src/shared/widthExprAst.ts` (new) | 1 | AST node types + `parse()`, `evaluate()`, `serialize()`. |
| `src/test/suite/shared/evalWidthExpr.test.ts` | 1 | Function cases. |
| `src/test/suite/shared/widthExprSerialize.test.ts` (new) | 2 | Dialect serialization cases. |
| `src/generator/registerProcessor.ts` | 1+2 | AST compound detection; `serialize` for `type`/`sv_type`. |
| `src/generator/resolvers/bus.ts` | 2 | `toTclWidth*` -> AST `serialize(ast,'tcl')`. |
| `src/generator/templates/amd_component_xml.j2` | 2 | Consume `port.width_expr_ipxact` for `spirit:dependency`. |
| `src/generator/templates/altera_hw_tcl.j2` | 2 | No change expected (consumes `tcl_width`). |
| `src/generator/templates/core.vhdl.j2` / `top.vhdl.j2` | 2 | Add `use ieee.math_real.all;` when a function width is used. |
| `src/parser/VerilogParser.ts` | 4 | Recognize `$clog2(PARAM)-1:0`. |
| `src/parser/VhdlParser.ts` | 4 | Function-call capture. |
| `docs/how-to/` + example `.ip.yml` | 4 | Documentation. |

## Risks

- **Vivado IP-XACT function support:** RESOLVED — UG1118 documents XPATH
  support (`ceiling`, `floor`, `log(base,num)`, etc.). `max`/`min` are
  listed as node-set functions with no two-scalar form, so they are
  **omitted from the IP-XACT dialect** (sentinel + literal/warn fallback);
  still available in SV/VHDL/Tcl.
- **Partial-generation hazard (verified):** shipping Phase 1 without Phase 2
  would emit raw `clog2(DEPTH)` into SV/VHDL port declarations (compile
  errors — `clog2` is not a built-in). Mitigated by the Phase 1 generation
  guard (`containsCall` check that hard-errors) and by not releasing
  Phase 1 standalone.
- **AST refactor of a working evaluator** could regress existing width
  expressions. Mitigated by keeping the public `evalWidthExpr` signature
  and the full existing test suite as a contract.
- **VHDL `math_real` visibility:** resolved by using the standard
  `ieee.math_real.all` (no custom function, no clash). Must be injected in
  the **entity context clause** (`core.vhdl.j2:9-13`) since the expanded
  expression appears in the entity port declaration; driven by the
  `usedFunction` flag from `serialize()`.
- **Tcl `log` is natural-log** — `clog2` expansion `ceil(log(x)/log(2))`
  must use `log(2)` constant correctly; verify Vivado and Quartus Tcl
  `expr` expose the same math functions (Phase 3).
- **`is_parameterized` semantics:** a function of a bare number
  (`clog2(8)`) is not parameterized; a function of a param
  (`clog2(DEPTH)`) is. The AST makes this a simple
  `containsParamRef(ast)` check.
- **Contract/types regeneration:** adding `width_expr_ipxact` to the port
  shape touches `src/generator/contract/templateContext.types.ts`; follow
  the `npm run generate-types` flow or extend the hand-written interfaces
  consistently (do not hand-edit generated regions).

## Out of scope

- Bitwise operators (`<<`, `>>`, `&`, `|`), modulo `%`, ternary `?:`.
- VHDL attribute syntax (`X'length`).
- User-defined functions (only the predefined table).
- `exp2`/`pow` (deferred as a pair — SV/VHDL have no synthesizable `pow`
  for bit-widths; revisit together if requested).
- `log2` (floor) SystemVerilog/VHDL serialization — numeric-eval-only
  until a `localparam`/macro helper is added (`$clog2` is the only SV
  built-in).
- Memory-map register width functions (issue is specifically about ports).
