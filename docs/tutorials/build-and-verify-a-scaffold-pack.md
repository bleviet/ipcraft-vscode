# Build and Verify Your Own Scaffold Pack

In this tutorial you will create a custom **scaffold pack**, generate RTL from an
IP core with it, and watch an open-source simulator and synthesis tool accept the
result. By the end you will have a working pack named `aurora-rtl` that produces a
full VHDL design *plus* a register-reference document — and you will understand the
mechanism that makes third-party packs safe: the **Template Context Contract**.

This is a learning exercise. You do not need to know how the generator works
internally before you start; you will see each moving part as you use it. For the
underlying design, read
[Template Context Contract and BYOT Generation](../concepts/generator-backbone.md)
afterwards — it will make a lot more sense once you have done this once.

!!! info "What you will learn"
    - How a scaffold pack maps templates to output files.
    - How a pack reuses built-in templates and adds its own.
    - What the *template context* is, and the contract that guarantees it is stable.
    - How the `apiVersion` gate protects your pack across IPCraft upgrades.
    - How to prove the generated RTL is real by compiling it with GHDL (and Icarus Verilog).

---

## Prerequisites

| You need | Why | Check |
|----------|-----|-------|
| VS Code with the IPCraft extension | Drives generation | Extension appears in the Extensions view |
| [GHDL](https://github.com/ghdl/ghdl) | Compiles the generated VHDL | `ghdl --version` |
| Icarus Verilog *(optional)* | Compiles the optional SystemVerilog output | `iverilog -V` |
| An empty workspace folder | Holds your IP core and pack | — |

This tutorial was verified with **GHDL 6.0** and **Icarus Verilog 12**. Any recent
release works.

### Create the sample IP core

Create a workspace folder and drop these two files in it. They describe a small
AXI4-Lite peripheral with two control/status registers — exactly the kind of IP a
register file and bus wrapper are generated for.

```yaml title="axi_slave.ip.yml"
vlnv:
  vendor: ipcraft
  library: templates
  name: axi_slave_core
  version: 1.0.0
description: IP core with AXI-Lite slave interface and register map
clocks:
- name: clk
  logicalName: CLK
  direction: in
  frequency: 100MHz
  associatedReset: reset_n
resets:
- name: reset_n
  logicalName: RESET_N
  direction: in
  polarity: activeLow
  associatedClock: clk
busInterfaces:
- name: s_axi_lite
  type: ipcraft:busif:axi4_lite:1.0
  mode: slave
  physicalPrefix: s_axil_
  associatedClock: clk
  associatedReset: reset_n
  memoryMapRef: CSR_MAP
  portWidthOverrides:
    AWADDR: 12
    ARADDR: 12
    WDATA: 32
    RDATA: 32
    WSTRB: 4
memoryMaps:
  import: axi_slave.mm.yml
```

```yaml title="axi_slave.mm.yml"
- name: CSR_MAP
  description: Control/Status Register Map for AXI-Lite slave
  addressBlocks:
  - name: CONTROL_REGS
    baseAddress: 0
    usage: register
    defaultRegWidth: 32
    registers:
    - name: CTRL
      description: Control register
      fields:
      - name: ENABLE
        bits: '[0:0]'
        access: read-write
        description: Global enable
      - name: MODE
        bits: '[2:1]'
        access: read-write
        description: Operating mode
      - name: RESERVED
        bits: '[31:3]'
        access: read-only
    - name: STATUS
      description: Status register
      access: read-only
      fields:
      - name: READY
        bits: '[0:0]'
        access: read-only
        description: Ready flag
      - name: BUSY
        bits: '[1:1]'
        access: read-only
        description: Busy flag
      - name: RESERVED
        bits: '[31:2]'
        access: read-only
```

Open `axi_slave.ip.yml` in VS Code. It opens in the IPCraft visual editor.

---

## Step 1 — Export a built-in pack as your starting point

Rather than write a pack from a blank file, copy one that already works.

1. Open the Command Palette (`Ctrl+Shift+P`) and run **IPCraft: Export Built-in Scaffold Pack**.
2. Choose **builtin-ipcraft** — the full layered pack (package, register file, core stub, bus wrapper, top).
3. When prompted for a name, enter `aurora-rtl`.

IPCraft copies the pack into your workspace, **including every template it references**:

```text
.vscode/ipcraft/packs/aurora-rtl/
  scaffold.yml
  package.vhdl.j2   pkg.sv.j2
  register_file.vhdl.j2   register_file.sv.j2
  core.vhdl.j2   core.sv.j2
  bus_axil.vhdl.j2   bus_axil.sv.j2
  bus_avmm.vhdl.j2   bus_avmm.sv.j2
  top.vhdl.j2   top.sv.j2
```

Open `scaffold.yml`. Each entry under `files:` is one generation rule:

```yaml
- source: "top.vhdl.j2"            # which template to render
  target: "rtl/{{ name }}.vhd"     # where to write the result
  condition: "not is_systemverilog" # when this rule applies
```

`source`, `target`, and `condition` are all rendered against the **template
context** — the bag of variables IPCraft computes from your IP core. `{{ name }}`,
`is_systemverilog`, and `bus_type` are all context fields. That context is the star
of this tutorial; you will meet it properly in Step 2.

!!! tip "Anything not in the pack falls back to built-in"
    You can delete templates you do not intend to change. The generator searches the
    pack directory first, then the built-in library. A pack can be nothing but a
    `scaffold.yml` and still produce a complete design.

---

## Step 2 — Add a template the built-in library does not have

Your pack will generate one artifact `builtin-ipcraft` never does: a Markdown
register reference, rendered from the same IP core. This shows two things at once —
a **pack-local template** (no built-in equivalent) and the **template context** in
action.

Create a new file in the pack directory:

```jinja title=".vscode/ipcraft/packs/aurora-rtl/memmap_doc.md.j2"
# {{ display_name }} — Register Map

<!-- Auto-generated by IPCraft from {{ entity_name }}.ip.yml -->
<!-- managed: false — add notes below freely; this file is never overwritten. -->

{% if description %}
{{ description }}

{% endif %}
**Bus interface:** {{ bus_type | upper }}
**Data width:** {{ data_width }} bits
**Address width:** {{ addr_width }} bits

## Register Summary

{% if registers %}
| Offset | Name | Access | Description |
|--------|------|--------|-------------|
{% for reg in registers %}
| `0x{{ '%02X' | format(reg.offset) }}` | `{{ reg.name }}` | `{{ reg.access }}` | {{ reg.description if reg.description else "—" }} |
{% endfor %}
{% else %}
*No registers defined.*
{% endif %}
```

Every `{{ … }}` here is a context field guaranteed by the contract:

| Field | Type | Where it comes from |
|-------|------|---------------------|
| `display_name`, `entity_name`, `description` | `string` | IP core identity |
| `bus_type` | `string` | The bus resolver (`axil`, `avmm`, …) |
| `data_width`, `addr_width` | `number` | The addressing resolver |
| `registers` | `Register[]` | The shadow-registers resolver; each has `offset`, `name`, `access`, `description` |

!!! warning "Mind the filter argument order"
    IPCraft's `format` filter is `format(formatString, value)`, so the pipe form is
    `{{ '%02X' | format(reg.offset) }}` — **not** `reg.offset | format('%02X')`.
    Reversing the arguments silently emits the literal text `%02X` instead of a
    formatted number.

Now register the new template by adding one rule to `scaffold.yml`, at the end of the
`files:` list:

```yaml
  # ── Register documentation (pack-local template) ──────────────────────────
  - source: "memmap_doc.md.j2"
    target: "docs/{{ name }}_registers.md"
    condition: "has_memory_mapped_slave"
    managed: false
```

`managed: false` means the file is written once and never overwritten, so engineers
can annotate it after generation. `condition: "has_memory_mapped_slave"` skips it for
IP cores that have no register map.

---

## Step 3 — Declare which contract version you target

Look at the top of `scaffold.yml`:

```yaml
name: "aurora-rtl"
apiVersion: "^1.0"
```

`apiVersion` is your pack's declaration of *which template context it was written
against*. The context is a versioned public API: within a major version it is
append-only — fields are added, never renamed, removed, or retyped — so a pack
written for `1.0` keeps working when IPCraft ships `1.4`. `^1.0` means "any `1.x`."

You do not have to take this on faith. In the next step you will make IPCraft enforce
it in front of you.

---

## Step 4 — Watch the contract gate reject an incompatible pack

Before rendering a single template, IPCraft checks your pack's `apiVersion` against
the contract version it ships. Make them incompatible on purpose:

1. In `scaffold.yml`, change `apiVersion: "^1.0"` to `apiVersion: "^2.0"` and save.
2. Make sure the active pack is yours — set it in the canvas **Scaffold Template**
   dropdown, or add to `.vscode/settings.json`:

   ```json
   { "ipcraft.generate.scaffoldPack": "aurora-rtl" }
   ```
3. Run **IPCraft: Generate HDL**.

Generation stops immediately with a clear, actionable error:

```text
Pack 'aurora-rtl' targets apiVersion '^2.0' but this IPCraft provides contract 1.0.0.
```

This is the contract doing its job: a pack that targets a future, breaking version is
rejected *up front* with a message naming the pack and both versions — never partway
through with a cryptic template error.

**Now revert** `apiVersion` back to `"^1.0"` and save. Generation will succeed in the
next step.

!!! note "The conformance kit"
    The same `apiVersion` check is exposed as a CI-friendly harness, the *pack
    conformance kit* (`npm run test:integration:conformance`), which validates every
    built-in pack against the running contract. You can point it at your own pack —
    at any location — to verify both that its `apiVersion` is compatible *and* that it
    generates without a contract violation:

    ```bash
    CONFORMANCE_PACK_DIR=/abs/path/to/aurora-rtl \
    CONFORMANCE_FIXTURE=/abs/path/to/axi_slave.ip.yml \
    npm run test:integration:conformance
    ```

---

## Step 5 — Generate the project

With `apiVersion` back to `^1.0` and `aurora-rtl` selected:

1. Open `axi_slave.ip.yml`.
2. Run **IPCraft: Scaffold Project** (or **IPCraft: Generate HDL** for RTL only).

IPCraft computes the context, validates it against the contract, then renders every
matching rule. The files that your pack governs:

```text
axi_slave_core/
  rtl/
    axi_slave_core_pkg.vhd     # package: register constants and types
    axi_slave_core_regs.vhd    # register file with field decode
    axi_slave_core_core.vhd    # user-logic stub (yours to edit)
    axi_slave_core_axil.vhd    # AXI-Lite bus wrapper
    axi_slave_core.vhd         # top entity
  docs/
    axi_slave_core_registers.md  # ← your pack-local template
```

Open `docs/axi_slave_core_registers.md`. The offsets are real, formatted hex — proof
your template received live data through the context:

```markdown
# Axi Slave Core — Register Map

**Bus interface:** AXIL
**Data width:** 32 bits
**Address width:** 3 bits

## Register Summary

| Offset | Name | Access | Description |
|--------|------|--------|-------------|
| `0x00` | `CTRL` | `read-write` | Control register |
| `0x04` | `STATUS` | `read-only` | Status register |
```

!!! note
    **Scaffold Project** may also emit `tb/` and vendor folders (`xilinx/`,
    `altera/`) depending on your `ipcraft.generate.targets` and testbench settings.
    They do not affect the compile step below.

---

## Step 6 — Compile the generated RTL

A generator you cannot trust is worse than no generator. Prove the output is real by
running it through GHDL: analyze (parse + type-check), elaborate (resolve the
hierarchy), and `--synth` (a synthesis pass).

Open a terminal in the generated `rtl/` directory. **Order matters** — compile in
dependency order: package, register file, core, bus wrapper, then top.

```bash
ghdl -a --std=08 \
  axi_slave_core_pkg.vhd \
  axi_slave_core_regs.vhd \
  axi_slave_core_core.vhd \
  axi_slave_core_axil.vhd \
  axi_slave_core.vhd

ghdl -e --std=08 axi_slave_core
ghdl --synth --std=08 axi_slave_core > /dev/null && echo "synthesis OK"
```

Expected output:

```text
synthesis OK
```

No errors from `-a`, `-e`, or `--synth` means the design parses, elaborates, and
synthesizes. Your custom pack produces RTL a real toolchain accepts.

### Optional: the SystemVerilog leg

Set `ipcraft.generate.hdlLanguage` to `systemverilog`, regenerate, and the same pack
emits `.sv` files instead (driven by the `is_systemverilog` context field). Compile
them with Icarus Verilog, same dependency order:

```bash
iverilog -g2012 -o sim.vvp \
  axi_slave_core_pkg.sv \
  axi_slave_core_regs.sv \
  axi_slave_core_core.sv \
  axi_slave_core_axil.sv \
  axi_slave_core.sv
```

You may see notices like `sorry: Case unique/unique0 qualities are ignored.` — these
are harmless; Icarus simply does not act on `unique case` hints. A zero exit code
means the SystemVerilog compiled.

---

## What just happened

You exercised the entire generator backbone without touching its internals:

1. **Resolvers** computed your IP core into a structured context — `registers` from
   the shadow-registers resolver, `data_width`/`addr_width` from the addressing
   resolver, `bus_type` from the bus resolver.
2. The **AJV gate** validated that context against the JSON Schema before any template
   ran. A missing or mistyped field would have failed here with a named constraint,
   not a Nunjucks stack trace.
3. The **`apiVersion` gate** (Step 4) confirmed your pack targets a compatible
   contract version *before* rendering.
4. Your pack's **rules** rendered built-in templates *and* your pack-local
   `memmap_doc.md.j2`, each reading the same guaranteed context.
5. **GHDL** and **Icarus Verilog** confirmed the output is correct HDL.

The payoff of the contract: the variables you used in Step 2 (`registers`,
`bus_type`, `data_width`, …) are guaranteed to exist with the same types and meanings
across every `1.x` release of IPCraft. Your pack is insulated from generator
internals — which is exactly what "bring your own template" requires.

---

## Next steps

- Edit a built-in template — change `top.vhdl.j2` in your pack and use
  **IPCraft: Preview Template Output** to see the rendered result live as you save.
- Read [Template Context Contract and BYOT Generation](../concepts/generator-backbone.md)
  for the design behind what you just used.
- See the full list of context fields and `scaffold.yml` options in the
  [Scaffold Packs how-to](../how-to/scaffold-packs.md) and the
  [Generator reference](../reference/generator.md).
- Add a testbench and run a real simulation: [Run cocotb Simulations](../how-to/run-cocotb-simulation.md).
