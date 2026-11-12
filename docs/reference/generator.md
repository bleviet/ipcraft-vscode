# Generator Reference

IPCraft can generate HDL, tests, documentation, and files for Vivado or Quartus.
The selected scaffold pack controls the exact file list and directory layout.

![Flow diagram: IP core, Generator, Linked memory maps, RTL, Tests, Documentation, Vivado files, Quartus files](../images/diagrams/reference-generator-1.drawio.svg)

## Main commands

| Command | Result |
|---|---|
| **IPCraft: Scaffold Project** | Complete output selected by the pack and settings |
| **IPCraft: Generate Top-Level HDL** | RTL only |
| **IPCraft: Generate CocoTB Testbench** | Python and simulator files |
| **IPCraft: Generate Vivado Project** | Vivado project scripts and constraints |
| **IPCraft: Generate Quartus Project** | Quartus project script and constraints |
| **IPCraft: Generate Documentation** | Markdown documentation supplied by the pack |

All generated files are shown in a staging review before IPCraft writes them.

## Common output layout

A complete built-in pack may produce:

```text
generated-core/
├── rtl/
│   ├── <name>_pkg.vhd
│   ├── <name>.vhd
│   ├── <name>_core.vhd
│   ├── <name>_<bus>.vhd
│   └── <name>_regs.vhd
├── tb/
│   ├── <name>_test.py
│   ├── test_<name>_sim.py
│   ├── register_model.py
│   ├── verification_manifest.json
│   └── Makefile
├── docs/
│   └── <name>_datasheet.md
├── xilinx/
│   ├── component.xml
│   └── ...
└── altera/
    ├── <name>_hw.tcl
    └── ...
```

SystemVerilog output uses `.sv` files and normally includes a package, top
module, core module, bus wrapper, and register module.

Smaller packs intentionally produce fewer files. See
[scaffold packs](../how-to/customizing-generated-files-with-scaffold-packs.md).

## Cocotb verification source of truth

For generated cocotb tests, `tb/verification_manifest.json` replaces
`memmap.yml` as the machine-readable test input. IPCraft derives the manifest
once from the normalized memory-map model and records the origin of every kind
of fact:

- register layout, reset values, access types, and array bounds come from the
  specification;
- readable and writable masks, write effects, reserved/unmapped read behavior,
  and hardware/software arbitration come from generator policy;
- bus type, data width, and byte-enable support come from the resolved bus
  binding.

`tb/register_model.py` is the transport-independent scoreboard. The generated
AXI4-Lite and Avalon-MM adapters drive that same model. The
`memmap.yml.j2` template remains available to scaffold packs as a
driver/documentation projection, but generated cocotb tests neither load nor
interpret it. It is therefore not a second verification oracle.

## Generation options

| Option | Default | Meaning |
|---|---|---|
| `targets` | `[]` | Vendor outputs such as `vivado` or `quartus` |
| `hdlLanguage` | `vhdl` | `vhdl` or `systemverilog` |
| `includeHdl` | `true` | Include RTL files |
| `includeRegs` | `true` | Include generated register logic |
| `includeTestbench` | `true` | Include test files |
| `includeDocs` | `true` | Include generated Markdown documentation |
| `includeVivadoProject` | `false` | Include Vivado project and build scripts |
| `targetPart` | Setting value | Vivado FPGA part |
| `includeQuartusProject` | `false` | Include Quartus project files |
| `quartusDevice` | Setting value | Quartus device part |

The IP Core toolbar writes the common choices to the current file or workspace
settings. Commands may ask for a missing part or device.

## Vendor targets

| Target | Packaging output |
|---|---|
| None | HDL, tests, and documentation only |
| `vivado` | `component.xml` and Vivado XGUI metadata |
| `quartus` | Platform Designer `_hw.tcl` component |
| Both | Both vendor packages |

Project creation is a separate choice. For example, Vivado packaging can be
generated without creating an out-of-context synthesis project.

## Bus selection

The generator uses the memory-mapped interface linked through `memoryMapRef`.
Supported built-in register wrappers include AXI4-Lite and Avalon
Memory-Mapped.

Use a full interface identity when possible, such as
`ipcraft:busif:axi4_lite:1.0`. IPCraft normalizes supported short names before
choosing templates.

## Template system

Templates use Nunjucks and have a `.j2` suffix. IPCraft searches the selected
scaffold pack first, then the built-in template library.

![Flow diagram: Output rule, Condition passes?, Skip file, Custom template found?, Render custom template, Render built-in template, Stage output](../images/diagrams/reference-generator-2.drawio.svg)

Common template values:

| Value | Meaning |
|---|---|
| `name`, `display_name` | Core names suitable for files and headings |
| `is_systemverilog` | Whether SystemVerilog is selected |
| `bus_type` | Short bus name used by templates |
| `has_memory_mapped_slave` | Whether register-bus output is needed |
| `has_endian_swap` | Whether top-level endian reflow logic is needed |
| `registers` | Registers sorted by address |
| `bus_ports`, `user_ports` | Physical interface and standalone ports |
| `interrupt_ports` | Interrupt signals with resolved bus-interface and clock associations |
| `endian_swap_ports`, `endian_swap_widths` | Ports and fixed widths used by endian reflow logic |
| `generics` | Core parameters |
| `xgui_pages` | Parameter `uiPage`/`uiGroup` layout as a page-group-parameter tree, for the Vivado xGUI |
| `display_items` | The same layout flattened into Platform Designer `add_display_item` records |
| `clock_port`, `reset_port` | Primary clock and reset names |

The versioned template-data schema is
`src/generator/contract/template_context.schema.json`. Template variables use
snake case by design; TypeScript and IPCraft schema properties use camel case.
The current contract version is 1.5.0. Version 1.5.0 adds per-register
`write_fields`, `needs_write_branch` and `read_source`, and register `access`
is derived from field accesses when a register has fields. Version 1.3.0 adds
`display_items`, display labels and Tcl-safe renderings for parameter metadata
and defaults.
Platform Designer group entries use stable internal IDs with their authored
`uiPage`/`uiGroup` text in `display_name`; templates should not treat the ID as
the visible label. Packs pinned to `~1.2` or an earlier minor must update their
range after validating the additive parameter layout context; built-in packs
use the compatible `^1.0` range.

## Testbench selection

| Framework | Supported simulator choices | Main output |
|---|---|---|
| Cocotb | GHDL, Icarus Verilog, Verilator, Questa | Python tests and simulator runner |
| VUnit | GHDL | `run.py` and VHDL testbench |

The framework controls how tests are written. The simulator choice controls how
the generated HDL is compiled and run.

See [Running a Cocotb simulation](../how-to/run-cocotb-simulation.md).

## Vendor build output

Vivado builds write reports under `xilinx/build/`; Quartus builds write output
under `altera/build/`. IPCraft parses timing and resource-use reports for the
Build view.

For commands, configuration, and report states, see
[Building a project](../how-to/building-a-project.md).

## Command-line package

The extension ships the `ipcraft` command-line tool for headless generation and
CI checks. It runs on VS Code's own runtime, so no separate Node.js installation
is required.

- **Integrated terminal:** `ipcraft` is on `PATH` automatically in every VS Code
  integrated terminal once the extension has started. Terminals opened before
  the extension started need to be restarted.
- **External terminals on this machine:** run `IPCraft: Install 'ipcraft' Command
  in PATH` from the Command Palette. Scripts and Makefiles run in those terminals
  work too. No sudo or administrator rights are needed. The installed command
  needs VS Code with this extension installed on the same machine, so CI runners
  without VS Code are not covered (the npm package remains separate and
  unpublished).
  `IPCraft: Uninstall 'ipcraft' Command from PATH` removes it again.

| OS | Installed command | PATH handling |
|---|---|---|
| Linux | `~/.local/bin/ipcraft` | Offers to copy the `export PATH` line if `~/.local/bin` is not on `PATH` |
| macOS | `~/.local/bin/ipcraft` | Offers to append the `export PATH` line to `~/.zprofile` (only after you click) or copy it |
| Windows | `%LOCALAPPDATA%\Programs\ipcraft\ipcraft.cmd` | Adds the directory to the user `PATH`; open a new terminal |

The installed command is a small shim that forwards to the copy bundled with the
extension, so it follows extension updates without reinstalling. It refuses to
overwrite an existing file that IPCraft did not create. In remote sessions
(Remote-SSH, WSL, Dev Containers, Codespaces) the command is installed on the
remote host.

The standalone `ipcraft` npm package remains unpublished and separate. Contributors
can build a local package archive and install it in a clean environment:

```bash
npm run package:cli
npm install --global ./build/ipcraft-0.9.2.tgz
ipcraft generate path/to/core.ip.yml --target quartus --lang vhdl --out gen/
```

| Option | Meaning |
|---|---|
| `--target <vendor>` | Vendor output; repeat or use a comma-separated list |
| `--lang <language>` | `vhdl` or `systemverilog` |
| `--out <directory>` | Generated project directory |
| `--pack <name>` | Scaffold pack override |
| `--quartus-device <part>` | Quartus device |
| `--vivado-part <part>` | Vivado part |
| `--indent-style <spaces\|tab>` | Indentation style for generated HDL/TCL/XDC/SDC (default: `spaces`) |
| `--indent-size <n>` | Spaces per indentation level when `--indent-style` is `spaces` (default: `2`) |

Use `verify` to compare committed output with a fresh in-memory generation:

```bash
ipcraft verify path/to/core.ip.yml gen/ --target quartus --lang vhdl
```

It exits with a non-zero status and lists stale or missing files when the
directory differs. Pass the same `--indent-style`/`--indent-size` (and any
other generation flags) used to produce the committed output, or affected
generated source files will be reported stale against the default 2-space
regeneration.

### Packaging a self-contained IP

`package` bundles an `.ip.yml` and every file it references into one folder or
`.zip`, including files outside the IP directory:

```bash
ipcraft package path/to/core.ip.yml --out dist/core_1.0.0
ipcraft package path/to/core.ip.yml --out dist/core_1.0.0.zip --zip
```

Referenced files are the memory map and file set imports, `fileSets[].files`,
`useBusLibrary`, and subcores that have a `path:` (bundled transitively). Files
inside the IP directory keep their relative paths; external files are copied
under `deps/` and the references in the packaged `.ip.yml` are rewritten, with
comments and hex literals preserved. Subcores given only as a VLNV are not
bundled and produce a warning. The folder must not exist or must be empty; with
`--zip` the file must not exist, and `.zip` is appended to `--out` if it is
missing.

Limits: all problems (missing paths, file references that are directories,
symlink loops in the bus library, package-path conflicts) are reported together
and nothing is written. A package-path conflict occurs when the IP already has
its own `deps/` folder that collides with the copied externals, or when a file
set lists a file that packaging rewrites, such as a subcore's own `.ip.yml`
that has external references. Plain files inside a subcore folder are
deduplicated. In VS Code the same service is available as
**IPCraft: Package IP Core (Self-Contained)**.

### Rendering a system design or an IP core as an image

`render` draws one level of a system design, or the symbol of an IP core, as an
SVG, PNG or JPG image for documentation. It reads a Vivado block design `.tcl`, a
Platform Designer `.qsys`, a `qsys-script` `.tcl` or an `.ip.yml`, and needs no
VS Code window:

```bash
ipcraft render bd/system.tcl --out docs/img/system.svg
ipcraft render path/to/uart.ip.yml --out docs/img/uart.svg --theme dark
ipcraft render bd/system.tcl --out docs/img/dsp.svg --level /dsp_pipeline --theme dark
ipcraft render bd/system.tcl --out docs/img/system.svg --expand /dsp_pipeline --no-grid
ipcraft render bd/system.tcl --out docs/img/system.png --scale 3
ipcraft render bd/system.tcl --out docs/img/dma.png --select axi_dma_0 --hops 2
ipcraft render bd/system.tcl --out docs/img/clocks.svg --clocks
ipcraft render path/to/uart.ip.yml --out docs/img/uart.jpg --quality 80
ipcraft render bd/system.tcl --out docs/img/system.svg --workspace .
ipcraft render --manifest docs/images.yml
```

| Option | Meaning |
|---|---|
| `--out <file>` | Output file (required); the extension picks the format: `.svg`, `.png`, `.jpg` or `.jpeg`. The folder is created if needed |
| `--level <path>` | System designs only. Hierarchy level to draw (default `/`, the top level) |
| `--expand <path>[,...]` | System designs only. Hierarchy blocks drawn expanded in place, by instance path or name; repeat or comma-separate. A block of the level, or of a block that is itself expanded (`--expand /dsp_pipeline,/dsp_pipeline/coeff_bank`) |
| `--select <name>[,...]` | System designs only. Draw only these blocks (instance name or path on the level) or external ports (`port:<name>`) and the blocks around them, laid out compactly as the viewer's isolated view; repeat or comma-separate. The selected blocks get the viewer's selection outline. Names inside an expanded block cannot be selected |
| `--hops <n>` | System designs only, with `--select`. How many connections away from the selection to draw: an integer of at least 1 (default 1). A larger value is cut to the furthest block connected to the selection. Clock and reset nets do not count as connections |
| `--highlight <name>[,...]` | System designs only. Draw these blocks or ports (`port:<name>`) with the selection outline without hiding anything; with `--select` they must be in the isolated view, and they may be blocks inside an expanded block |
| `--clocks` | System designs only. Draw the viewer's Clocks and resets view: pins colored by clock domain, a domain strip and crossing count in block headers, clock frequencies, clock domain crossings as dashed wires in the warning color with other data wires faded, and the domains in the legend |
| `--theme <light\|dark>` | Image palette (default `light`; the VS Code theme does not matter) |
| `--no-grid` | Omit the background grid dots |
| `--no-legend` | System designs only. Omit the wire-category legend below the drawing |
| `--background <editor\|transparent>` | Fill with the palette background (default) or leave transparent. A JPG cannot be transparent |
| `--scale <1-4>` | PNG and JPG only. Pixels per SVG unit, an integer (default 2) |
| `--quality <1-100>` | JPG only. JPEG quality (default 90) |
| `--workspace <dir>` | System designs only. Folder searched for the `.ip.yml`, HDL and `.qsys` files that define the design's instances (default: the design file's folder) |
| `--no-workspace` | System designs only. Draw the design exactly as the file declares it, without those definitions |
| `--manifest <file.yml>` | Render every image listed in a [manifest](#rendering-many-images-from-one-manifest). Takes no input file and no other option |

The SVG uses plain shapes and text only (no `foreignObject`, scripts or CSS
variables), so it opens in Inkscape, LibreOffice and Word. The IBM Plex fonts
used for text are embedded in the file. The same input and options always
produce the same bytes, so a committed image only changes when the design does.

PNG and JPG are drawn from that SVG by a bundled WebAssembly rasterizer (resvg),
so they need no browser or system fonts, and the text uses the same IBM Plex
faces. Bold monospace text is drawn with the regular face, as the renderer ships
only IBM Plex Mono 400. A JPG has no alpha channel, so it is filled with the
palette background; use a PNG for a transparent image.

An `.ip.yml` is drawn as the IP core editor's canvas shows it: the block with
its name, vendor and library, dependencies, generics, ports (clocks, resets,
interrupts, data ports and collapsed bus interfaces with their protocol, mode and
memory map badges) and description. Bus interface names and protocols come from
the built-in bus library plus the file's own `useBusLibrary` folder; bus
libraries configured in VS Code settings or found in the workspace are not read.
The options `--level`, `--expand`, `--select`, `--hops`, `--highlight`, `--clocks`, `--no-legend`, `--workspace` and `--no-workspace` are errors for an `.ip.yml`,
and so is a file that declares a newer `apiVersion` than this IPCraft supports.

An unknown `--level`, `--expand`, `--select` or `--highlight` name exits with code 1 and lists the closest
names. Expanded bus interfaces in the IP symbol are not part of `render` yet.

#### Workspace definitions

A design file often does not list the pins of its blocks. `render` finds them
the way the system viewer does: it searches the `--workspace` folder (default:
the design file's folder) and everything below it for

- an `.ip.yml` whose VLNV matches a Vivado block (case-insensitively), or whose
  name matches a Platform Designer component, and adds the definition's pins;
- an HDL file (`.vhd`, `.vhdl`, `.v`, `.sv`) declaring the entity or module that
  a Vivado module reference names, and adds its ports;
- a `.qsys` file named like the `kind` of a Platform Designer module, which is
  drawn as a hierarchy block holding that system (use `--level` or `--expand` to
  open it).

When several files match, the one nearest the design file wins; a tie is left
undefined. The search follows symbolic links (not into a loop), skips
`node_modules`, `.git`, `.Xil` and Vivado-generated folders (`*.gen`, `*.cache`,
`*.ip_user_files`, `*.runs`, `*.sim`) anywhere in a path relative to the
workspace folder (the viewer applies the same filter to the whole path), reads at
most 2000 `.ip.yml`, 5000 HDL and 2000 `.qsys` files, the first by sorted
relative path, and ignores HDL files over 1 MiB. VS Code's `files.exclude`
setting is not applied. Without a match the block is drawn as the design
declares it, so a design with no definitions nearby gives the same image with or
without `--workspace`. Use `--no-workspace` for that image on purpose. A folder
or an invalid `.ip.yml` that is skipped is reported as a warning on stderr.

The command reads those files without asking for trust, like `generate`; point
`--workspace` only at folders you trust. Display names are relative to the
workspace folder, and the result does not depend on file system order.

#### Rendering many images from one manifest

`ipcraft render --manifest docs/images.yml` renders every entry of a YAML file.
Paths are relative to the manifest file.

```yaml
defaults: { theme: light, scale: 2, legend: true }
images:
  - source: ip/axi_dma.ip.yml
    out: docs/img/axi_dma.svg
  - source: bd/system.tcl
    out: docs/img/dma-context.png
    select: [axi_dma_0]
    hops: 2
    workspace: ip
```

Each entry takes `source` and `out` (required) and the options `level`,
`expand`, `select`, `hops`, `highlight`, `clocks`, `theme`, `scale`, `quality`,
`grid`, `legend`, `background` and `workspace` (a folder, or `false` for none).
`expand`, `select` and `highlight` are lists or comma-separated strings;
`clocks`, `grid` and `legend` are `true` or `false`. `defaults` takes the same
keys except `source` and `out`, which every image sets itself, and applies under
every entry. A default that an entry cannot use is skipped: `scale` for an SVG,
`quality` for a non-JPG, `background: transparent` for a JPG, `hops` without
`select`, and the system design options (`level`, `expand`, `select`, `hops`,
`highlight`, `clocks`, `legend`, `workspace`) for an `.ip.yml`. A key set on the
entry itself is checked like the matching flag, with the same message. An
unknown key is an error, as are an empty `images` list and two images with the
same `out`. `workspace: false` (or `null`) draws that design without workspace
definitions, like `--no-workspace`.

The images are rendered one after another in file order, sharing the fonts, the
rasterizer, the bus library and the workspace file lists. Each success prints
`Rendered <path>`. An entry that fails prints `images[<index>] (<source>):
<message>` on stderr and the others still render; the exit code is 1 if any
failed, 0 otherwise. A problem with the manifest as a whole (unreadable file,
invalid YAML, unknown top-level key) renders nothing and exits with 1. Output
folders are created. An image from a manifest is byte for byte the image the
same options give on the command line.

### Upgrading `.ip.yml` to the latest format version

An `.ip.yml` declares its file format version in `apiVersion` (`1.0`, `1.1`, or `1.2`);
a file without `apiVersion` is version 1.0. IPCraft reads every version up to
its latest (1.2), refuses a file that declares a newer version with an error
asking you to upgrade IPCraft, and can upgrade older files. Version 1.1
introduced bus interface contracts: legacy port names such as Avalon-MM
`read_n` or `waitrequest_n` become one port plus an entry in
`portPolarityOverrides`. Version 1.2 added port field metadata and changes no
existing content. The IP Core editor applies this upgrade (and sets
`apiVersion: '1.2'`) when you make the first edit to an older file; to upgrade
explicitly, run:

```bash
ipcraft migrate path/to/core.ip.yml other.ip.yml
ipcraft migrate path/to/core.ip.yml --check
ipcraft migrate path/to/map.mm.yml
```

Each file is rewritten in place only when it changes, preserving comments and
hex literals; the command prints `Upgraded <path> (1.0 -> 1.2, <n> change(s))`
or `Up to date: <path> (1.2)`. With `--check` nothing is written, files that
need an upgrade are listed as `Needs upgrade: <path> (1.0 -> 1.2)`, and the
exit status is 1 if any file would change (useful in CI). A file that cannot
be read or parsed, or that declares a newer version, is reported and makes the
exit status 1, but the remaining files are still processed. The bus library
honors `useBusLibrary` from each file.

In VS Code, the same migration is available as **IPCraft: Migrate .ip.yml /
.mm.yml to Latest Format**, from the Explorer context menu (multi-select is
supported) or the Command Palette for the active `.ip.yml` or `.mm.yml`. Like
`ipcraft migrate`, it also converts legacy keys in `.mm.yml` files and repairs a
dangling `memoryMapRef`. It applies one
undoable edit per file and saves it. If a file already has unsaved changes in
the editor, the upgrade is applied to the open buffer but the file is not
saved, so your unrelated edits are not written to disk unasked; the summary
message reports how many files were left unsaved.

The CLI source was introduced by [issue #72](https://github.com/bleviet/ipcraft-vscode/issues/72)
and remains in this repository so it uses the same generator as the extension.
Its npm release is tracked by
[issue #116](https://github.com/bleviet/ipcraft-vscode/issues/116) and is a
separate, explicitly manual release after the matching extension version has
been published. Shipping the CLI inside the extension and putting it on `PATH`
is tracked by [issue #206](https://github.com/bleviet/ipcraft-vscode/issues/206).

### Converting legacy snake_case keys

IPCraft reads camelCase keys only. Old files may still use snake_case spellings
such as `address_blocks`, `base_address`, `address_offset`, `reset_value`,
`memory_maps`, `file_sets`, `use_optional_ports` or `physical_prefix`. Run
`ipcraft migrate` to convert them. It works for `.ip.yml` and `.mm.yml` files,
renames the keys in place, and keeps comments, key order and hex literals. For
an `.ip.yml` file the conversion runs together with the version upgrade, and a
file that is already at the latest version is still rewritten when it has
legacy keys. If a node has both spellings, the camelCase key wins and the
legacy key is removed. A `.mm.yml` file has no `apiVersion`, so only keys are
renamed. In an `.ip.yml` file, `ipcraft migrate` also rewrites a dot-separated
bus `type` such as `ipcraft.busif.axi4_lite.1.0` (the spelling the IPCraft
Python CLI uses) to its colon VLNV `ipcraft:busif:axi4_lite:1.0` when that
VLNV resolves in the active bus library, at any format version. The VS Code Migrate command handles `.ip.yml` files the same way.

## Contributor implementation

Implementation details belong in [generator architecture](../architecture/generator-backbone.md).
Source templates are under `src/generator/templates/`; copied files under
`dist/templates/` must not be edited.
