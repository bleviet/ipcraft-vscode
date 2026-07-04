# Customising Code Generation with Scaffold Packs

How to change the file layout, naming, and structure of generated RTL code by creating or modifying a scaffold pack.

A **scaffold pack** is a folder containing a `scaffold.yml` manifest and optional Nunjucks (`.j2`) template overrides.
It tells the generator which files to produce, from which templates, under which conditions.
Five packs ship with IPCraft — two production-ready and three annotated examples:

| Pack | Category | What it generates |
|------|----------|-------------------|
| `builtin-minimal` | Built-in | One top-level stub per IP core (entity/module, empty body) |
| `builtin-ipcraft` | Built-in | Full layered set: package, top, core, bus wrapper, register file |
| `example-register-only` | Example | Only the register file decoder — for IPs with existing RTL |
| `example-no-regfile` | Example | Full layered set without the register file — write your own decode |
| `example-with-docs` | Example | Full layered set plus a Markdown register reference document |

The example packs have extensively commented `scaffold.yml` files that explain every
field, making them useful learning material even if you do not use them directly.

The generator uses `builtin-minimal` as the default scaffold pack unless you override it.

!!! tip "Interactive walkthrough"
    Open the VS Code **Get Started** tab and search for **Get Started with Scaffold Packs**
    for a step-by-step interactive guide through the full workflow.

---

## Selecting a Scaffold Pack

The active pack is a workspace setting — it applies to all IP cores in the workspace
and is independent of the `.ip.yml` spec file.

**Option A — Canvas dropdown (recommended)**

Open any `.ip.yml` in the visual editor. The **Scaffold Template** dropdown
in the toolbar lists every detected pack, grouped by category. Selecting a pack saves
it to `ipcraft.generate.scaffoldPack` immediately.

**Option B — VS Code settings**

Set `ipcraft.generate.scaffoldPack` in your workspace `settings.json`:

```json
{
  "ipcraft.generate.scaffoldPack": "my-aurora-layout"
}
```

The generator looks for the pack in this order:

1. `.vscode/ipcraft/packs/<name>/scaffold.yml` (workspace-local pack)
2. Built-in packs shipped with the extension (`builtin-minimal`, `builtin-ipcraft`)

When `ipcraft.generate.scaffoldPack` is empty, `builtin-minimal` is used as a fallback.

---

## Previewing a Template Side by Side

Before editing a template you can see the rendered output next to the source.

1. Open any `.j2` file in the editor (built-in or from a custom pack).
2. Click the **$(open-preview) Preview Template Output** icon in the editor title bar,
   or run **IPCraft: Preview Template Output** from the Command Palette.
3. A read-only preview document opens beside the editor showing the rendered result.
4. Save the `.j2` file — the preview refreshes automatically.

The preview needs an IP core file to render against. On first use IPCraft scans the workspace
for `.ip.yml` files:

- If exactly one file is found it is used automatically.
- If several are found a quick-pick lets you choose one.
- Select **Always use this file** in the follow-up prompt to pin it for all future previews.

You can change the pinned file at any time with **IPCraft: Pin Preview IP Core**.

!!! note "Preview language highlighting"
    The preview document's filename is derived from the template name with `.j2` stripped
    (e.g. `top.vhdl.j2` → `top.vhd`), so VS Code applies the correct syntax highlighting.

---

## Exporting a Built-in Pack to Customise It

The quickest way to create a custom pack is to start from a built-in one.

1. Open the Command Palette and run **IPCraft: Export Built-in Scaffold Pack**.
2. A grouped list shows **Built-in** packs and **Examples** with their descriptions.
   Select the one closest to your goal.
3. Enter a name for your copy (e.g. `aurora-rtl`). The `builtin-` / `example-` prefix is stripped automatically.
4. IPCraft copies the pack to `.vscode/ipcraft/packs/<name>/` in your workspace,
   **including all `.j2` template files** referenced by the pack so you can edit
   them immediately.
5. Click **Open scaffold.yml** in the confirmation notification.

The scaffold.yml opens in the editor and the **Scaffold Pack Preview** panel appears
beside it showing which files would be generated.

The exported directory contains everything you need:

```text
.vscode/ipcraft/packs/aurora-rtl/
  scaffold.yml
  top.vhdl.j2
  top.sv.j2
  package.vhdl.j2
  pkg.sv.j2
  core.vhdl.j2          ← edit this to change the logic skeleton
  core.sv.j2
  bus_axil.vhdl.j2      ← edit this to change the AXI-Lite wrapper
  bus_axil.sv.j2
  bus_avmm.vhdl.j2
  bus_avmm.sv.j2
  register_file.vhdl.j2
  register_file.sv.j2
```

From here:

- Edit any `.j2` file directly — the side-by-side preview updates on save.
- Edit `scaffold.yml` to add, remove, or rename output files.
- Delete template files you do not need to customise — the generator falls back
  to the built-in version for any template not found in the pack directory.

Activate the pack by selecting it in the canvas **Scaffold Template** dropdown,
or by setting `ipcraft.generate.scaffoldPack: "aurora-rtl"` in workspace settings.

---

## Understanding the Live File Tree Panel

Whenever you open or save a `scaffold.yml` file the **Scaffold Pack Preview** panel
(titled *IPCraft — Scaffold Pack Preview*) shows a live file tree of what the pack
would generate against the pinned IP core.

```
Scaffold Pack: aurora-rtl
.vscode/ipcraft/packs/aurora-rtl

● 6 generated  ○ 2 skipped  🔒 1 user-owned

rtl/
  ● spi_controller_pkg.vhd
  ● spi_controller.vhd
  🔒 spi_controller_core.vhd              user-owned
  ● spi_controller_axil.vhd
  ● spi_controller_regs.vhd
  ○ spi_controller_regs.sv    condition false
```

| Indicator | Meaning |
|-----------|---------|
| Green dot | File would be generated |
| Grey dot + *condition false* | File is skipped because its `condition` evaluated to false |
| Lock icon + *user-owned* | `managed: false` — written only on first generation, never overwritten |

If no `.ip.yml` is found in the workspace the panel shows the unevaluated rule targets and
a banner explaining that conditions were not evaluated.

---

## Writing a Scaffold Pack from Scratch

### Directory layout

```text
.vscode/ipcraft/packs/my-pack/
  scaffold.yml          ← required manifest
  top.vhdl.j2           ← optional: overrides the built-in template of the same name
  core.vhdl.j2          ← optional: same
  custom_header.vhdl.j2 ← optional: new template only used by this pack
```

Templates placed in the pack directory shadow the extension's built-in templates of the
same name. Templates not overridden are resolved from the built-in library automatically.

### `scaffold.yml` format

```yaml
name: "my-pack"
description: "Brief description shown in the Scaffold Pack Preview panel"
fullGeneration: true     # true → testbench gets register/bus context; false → minimal stub

files:
  - source: "top.vhdl.j2"           # template filename (or Nunjucks expression)
    target: "rtl/{{ name }}.vhd"    # output path relative to the output directory
    condition: "not is_systemverilog"

  - source: "custom_header.vhdl.j2"
    target: "rtl/{{ name }}_header.vhd"

  - source: "core.vhdl.j2"
    target: "rtl/{{ name }}_core.vhd"
    managed: false         # user-owned: written once, never overwritten
```

Both `source` and `target` are Nunjucks expressions rendered against the template context,
so you can use variables anywhere in the path:

```yaml
- source: "bus_{{ bus_type }}.vhdl.j2"     # resolves to bus_axil.vhdl.j2, bus_avmm.vhdl.j2, …
  target: "rtl/{{ name }}_{{ bus_type }}.vhd"
  condition: "has_memory_mapped_slave and not is_systemverilog"
```

### `fullGeneration` flag

| Value | Testbench context |
|-------|-------------------|
| `true` | Testbench receives full register and bus interface context (registers, bus_ports, etc.) — suitable for packs that generate a bus wrapper and register file |
| `false` | Testbench receives a minimal context with `has_memory_mapped_slave` cleared — suitable for packs that produce only a top-level stub |

### `managed` flag

| Value | Behaviour |
|-------|-----------|
| `true` (default) | IPCraft regenerates the file on every run |
| `false` | The file is written on first generation; subsequent runs leave it untouched if it already exists on disk |

Use `managed: false` for user logic stubs (e.g. the core file) so that edits are never
accidentally overwritten.

---

## Overriding Testbench Templates

The same shadowing rule applies to testbench generation (**Generate CocoTB Testbench** /
the testbench step of **Generate Scaffold Project**): drop a `.j2` file with the same
name as a built-in testbench template directly in the pack directory, no `scaffold.yml`
entry required. The active scaffold pack is checked first; the built-in template is used
only when the pack does not provide an override.

The overridable built-in CocoTB templates (in `src/generator/templates/`) are:

| Template | Output |
|----------|--------|
| `cocotb_test.py.j2` | `tb/{{ name }}_test.py` |
| `cocotb_conftest.py.j2` | `tb/conftest.py` |
| `cocotb_pytest.py.j2` | `tb/test_{{ name }}_sim.py` |
| `cocotb_makefile.j2` | `tb/Makefile` (VHDL) |
| `cocotb_makefile.sv.j2` | `tb/Makefile` (SystemVerilog) |
| `cocotb_dump.v.j2` | `tb/dump.v` (SystemVerilog only) |
| `mm_loader.py.j2` | `tb/mm_loader.py` (memory-mapped slave only) |
| `vscode_settings.json.j2` | `.vscode/settings.json` |

```text
.vscode/ipcraft/packs/my-pack/
  scaffold.yml
  cocotb_test.py.j2      ← optional: overrides the built-in CocoTB test stub
```

---

## Overriding Vendor Project Templates

Vendor toolchain output that is template-driven follows the same shadowing rule too —
overridable via every command that scaffolds a Vivado/Quartus target (**Generate
Scaffold Project**, **Export Altera/Xilinx Component**, **Generate Vivado/Quartus
Project**, and the build variants):

| Template | Output |
|----------|--------|
| `altera_hw_tcl.j2` | `altera/{{ name }}_hw.tcl` |
| `quartus_project.tcl.j2` | `altera/{{ name }}_project.tcl` (project generation only) |
| `quartus_sdc.j2` | `altera/{{ name }}.sdc` (project generation only) |
| `amd_xgui.j2` | `xilinx/xgui/{{ name }}_v{{ version }}.tcl` |
| `vivado_project.tcl.j2` | `xilinx/{{ name }}_project.tcl` (project generation only) |
| `vivado_ooc.xdc.j2` | `xilinx/{{ name }}.xdc` (project generation only) |
| `vivado_run_ooc.tcl.j2` / `vivado_run_xpr.tcl.j2` | `xilinx/{{ name }}_run_ooc.tcl` / `_run_xpr.tcl` (project generation only) |
| `component.xml.j2` | `xilinx/component.xml` — full-file override only, see below |

!!! note "component.xml override is all-or-nothing"
    Vivado's `component.xml` is built programmatically (`VivadoComponentXmlGenerator`), not
    rendered from a built-in `.j2` template, so there's no built-in template for a pack file
    to shadow piece-by-piece. Instead, if the pack directory contains a `component.xml.j2`,
    it fully replaces the generated file — there's no partial override. The template receives
    the same context as other `.j2` templates in the pack, plus `ip_core`, `bus_definitions`,
    `rtl_files`, `xgui_file`, `xgui_checksum`, `is_systemverilog`, and `memory_maps`. Omit
    the file and the built-in generator runs as before.

---

## Template Context Variables

The following variables are available inside every `.j2` template and in
`condition`, `source`, and `target` expressions:

### Core identity

| Variable | Type | Example |
|----------|------|---------|
| `name` | `string` | `"spi_controller"` |
| `entity_name` | `string` | same as `name` |
| `vendor` | `string \| undefined` | `"acme"` |
| `library` | `string \| undefined` | `"user"` |
| `version` | `string \| undefined` | `"1.0"` |
| `description` | `string` | `""` |

### HDL language

| Variable | Type | Values |
|----------|------|--------|
| `hdl_language` | `string` | `"vhdl"` or `"systemverilog"` |
| `is_systemverilog` | `boolean` | `true` when generating SV |

### Bus interface

| Variable | Type | Notes |
|----------|------|-------|
| `bus_type` | `string` | `"axil"`, `"avmm"`, `"axi4"`, `"axis"` |
| `has_memory_mapped_slave` | `boolean` | `true` when a memory-mapped slave interface exists |
| `bus_ports` | `Port[]` | Active ports of the primary bus interface |
| `secondary_bus_ports` | `Port[]` | Ports of additional bus interfaces |
| `bus_prefix` | `string` | Physical signal prefix of the primary bus (e.g. `"s_axi"`) |
| `expanded_bus_interfaces` | `BusInterface[]` | All bus interfaces after array expansion |

### Registers

| Variable | Type | Notes |
|----------|------|-------|
| `registers` | `Register[]` | Flattened register list, sorted by address offset |
| `sw_registers` | `Register[]` | Registers with software write access |
| `hw_registers` | `Register[]` | Registers with hardware read-only access |
| `includeRegs` | `boolean` | `true` when register file generation is enabled |

### Clocks and resets

| Variable | Type | Example |
|----------|------|---------|
| `clock_port` | `string` | `"clk"` |
| `reset_port` | `string` | `"rst_n"` |
| `reset_active_high` | `boolean` | `false` for active-low reset |
| `clocks_with_period` | `Clock[]` | Clocks with resolved period in ns |

### Ports and generics

| Variable | Type | Notes |
|----------|------|-------|
| `user_ports` | `Port[]` | Ports not belonging to a bus interface |
| `generics` | `Generic[]` | IP core parameters |
| `interrupt_ports` | `Port[]` | Declared interrupt ports |

### Condition shorthand reference

Common condition expressions used in `scaffold.yml`:

```yaml
condition: "not is_systemverilog"          # VHDL only
condition: "is_systemverilog"              # SV only
condition: "has_memory_mapped_slave"       # bus wrapper / register file
condition: "has_memory_mapped_slave and not is_systemverilog"
condition: "includeRegs and has_memory_mapped_slave"
```

---

## Example: Minimal Custom Pack

This pack generates a single VHDL or SV file with a company-specific file header
provided by a custom template:

```text
.vscode/ipcraft/packs/acme-minimal/
  scaffold.yml
  top.vhdl.j2          ← company header + entity (overrides built-in)
  top.sv.j2            ← company header + module (overrides built-in)
```

```yaml title=".vscode/ipcraft/packs/acme-minimal/scaffold.yml"
name: "acme-minimal"
description: "ACME Corp single-file stub with company header"
fullGeneration: false

files:
  - source: "top.vhdl.j2"
    target: "rtl/{{ name }}.vhd"
    condition: "not is_systemverilog"

  - source: "top.sv.j2"
    target: "rtl/{{ name }}.sv"
    condition: "is_systemverilog"
```

```json title=".vscode/settings.json"
{
  "ipcraft.generate.scaffoldPack": "acme-minimal"
}
```

---

## Example: Full Pack with Extra Artifacts

This pack extends `builtin-ipcraft` with an additional Markdown stub for
register documentation placed next to the RTL:

```yaml title=".vscode/ipcraft/packs/doc-aware/scaffold.yml"
name: "doc-aware"
description: "Full layered generation plus per-IP register documentation stub"
fullGeneration: true

files:
  # ── VHDL ──────────────────────────────────────────────────────────────────
  - source: "package.vhdl.j2"
    target: "rtl/{{ name }}_pkg.vhd"
    condition: "not is_systemverilog and has_memory_mapped_slave"

  - source: "top.vhdl.j2"
    target: "rtl/{{ name }}.vhd"
    condition: "not is_systemverilog"

  - source: "core.vhdl.j2"
    target: "rtl/{{ name }}_core.vhd"
    condition: "not is_systemverilog and has_memory_mapped_slave"
    managed: false

  - source: "bus_{{ bus_type }}.vhdl.j2"
    target: "rtl/{{ name }}_{{ bus_type }}.vhd"
    condition: "not is_systemverilog and has_memory_mapped_slave"

  - source: "register_file.vhdl.j2"
    target: "rtl/{{ name }}_regs.vhd"
    condition: "not is_systemverilog and includeRegs and has_memory_mapped_slave"

  # ── Documentation stub ────────────────────────────────────────────────────
  - source: "register_doc.md.j2"    # pack-local template, not in built-in library
    target: "docs/{{ name }}_registers.md"
    condition: "has_memory_mapped_slave"
    managed: false
```

The `register_doc.md.j2` template is a new file in the pack directory — it has no
built-in equivalent so it must be provided by the pack.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| *Scaffold pack '…' not found* | Check the pack folder name matches `ipcraft.generate.scaffoldPack` exactly; workspace packs must be under `.vscode/ipcraft/packs/` |
| *template not found: …* | The `source` expression resolved to a template name that exists in neither the pack directory nor the built-in library; check spelling |
| Condition never passes | Use the **Scaffold Pack Preview** panel to see which conditions evaluate to true/false for your IP core |
| Preview shows "No .ip.yml found" | There is no IP core file in the workspace; create one or use **IPCraft: Pin Preview IP Core** to point to one elsewhere |
| Preview not refreshing | Verify `auto-save` is off and the `.j2` file is saved explicitly (`Ctrl+S`) |
| `managed: false` file keeps being regenerated | The file must exist on disk for the protection to activate; run generation once to create it |
