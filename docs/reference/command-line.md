# Command Line

The `ipcraft` command runs IPCraft's generator, packager, migration, and
diagram renderer without the editor. It reads the same `.ip.yml` and `.mm.yml`
files and gives the same output as the VS Code commands, so a CI job can check
that committed files are current.

| Command | Does |
|---|---|
| `ipcraft generate <ip.yml>` | Generate RTL, testbench, and vendor projects |
| `ipcraft verify <ip.yml> <dir>` | Check that a generated directory matches a fresh generation |
| `ipcraft package <ip.yml> --out <path>` | Bundle a core with every file it references |
| `ipcraft migrate <file>...` | Upgrade `.ip.yml` and `.mm.yml` files to the latest format |
| `ipcraft render <design> --out <image>` | Draw a system design or an IP core symbol as SVG, PNG, or JPG |
| `ipcraft diff <design> --base <ref>` | Report what changed between two revisions of a system design |
| `ipcraft vhdl-ls` | Write a `vhdl_ls.toml` for the VHDL language server |

Run `ipcraft --help` for every option.

## Install

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

## Generate and verify

```bash
ipcraft generate path/to/core.ip.yml --target quartus,vivado --lang vhdl --out gen/
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

## Package a self-contained IP core

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

## Render a diagram as an image

`render` draws one level of a system design, or the symbol of an IP core, as an
SVG, PNG or JPG image for documentation. It reads a Vivado block design `.tcl` or `.bd`, a
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
| `--manifest <file.yml>` | Render every image listed in a [manifest](#render-many-images-from-one-manifest). Takes no input file and no other option |

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

### Workspace definitions

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

### Render many images from one manifest

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

## Compare two revisions of a system design

`diff` reports what changed between two revisions of a system design, in terms
of blocks, parameters, connections, external ports and the address map. It reads
a Vivado block design `.tcl` or `.bd`, a Platform Designer `.qsys` or a
`qsys-script` `.tcl`, and needs no VS Code window. The text of the files is not
compared; the two designs are read into the viewer's graph and the graphs are
compared, so the order of blocks and nets, net names, line numbers and tool
metadata do not show up as changes.

There are two forms:

```bash
# one file: the working tree (or --head) against a git revision
ipcraft diff bd/system.bd --base HEAD
ipcraft diff bd/system.bd --base main --head feature/fifo

# two files on disk
ipcraft diff old/system.qsys new/system.qsys

# fail a CI job when a pull request adds findings
ipcraft diff bd/system.bd --base origin/main --fail-on new-findings
```

| Option | Meaning |
|---|---|
| `--base <git ref>` | One-file form. The revision to compare with: a branch, tag, commit or `HEAD~1`. The file is read at the same path in the repository that contains it |
| `--head <git ref>` | One-file form, with `--base`. Compare with this revision instead of the working tree |
| `--format <markdown\|json>` | Report format (default `markdown`) |
| `--out <file>` | Write the report to this file instead of standard output. The folder is created if needed |
| `--ignore-version-only` | Leave out blocks whose only change is the version of their IP. The JSON report then has no instance with status `version` and `summary.version` is 0 |
| `--fail-on <changes\|new-findings>` | Exit with 1 when the check fails: `changes` on any change (the total of the summary, after `--ignore-version-only`; a difference of findings alone is not a change), `new-findings` on at least one new finding (resolved findings never fail) |
| `--image <file.svg\|png\|jpg>` | Also draw the top level of the current revision with the changes marked, to this file; the extension picks the format. The folder is created if needed |

`--image` draws what the viewer shows with **Marks** on, at the top level `/` of the
current revision with nothing expanded, in the look `ipcraft render` has by
default (light theme, grid, legend, editor background, scale 2). Added blocks,
blocks with changed parameters or pins, renamed and moved blocks, blocks with only a new
version and added or changed external ports have a border in the color of their
kind and a sign in the header (`+`, `~`, `→`, `»`, `v`); a hierarchy with changes inside
has a `~ N inside` count; the pins that gained or changed a connection have
their name in color; new wires are drawn in the added color, a little wider. The
legend names the kinds present and counts the removed blocks and ports as
`− N removed`: they are not drawn. With `--ignore-version-only`, blocks with only
a version change are not marked. For another level, an expanded hierarchy or
another look, use the viewer. The command prints `Wrote <file>` on its own line
after the report: to standard output when the report is written with `--out`, to
standard error when the report is on standard output, so the report stays clean.
`--fail-on` still decides the exit code, after the image is written. An image that cannot be drawn or written also exits with 1 and prints `Image failed: <reason>`; the report is still written.

```bash
ipcraft diff bd/system.bd --base main --image docs/img/changes.png
```

Without `--fail-on`, the exit code is 0 when the report is written, whether or
not the designs differ. It is 1 on an error (an option error, a file or
revision that cannot be read, or a file that is not a system design) or when
`--fail-on` fails the check, and when `--image` cannot be drawn or written.
The report is written or printed first in every case, so a CI job can fail and
still keep it. A failed image prints `Image failed: <reason>` to standard error,
before any failed check. A failed check prints one line to standard error, for
example `Diff check failed: 3 changes (--fail-on changes)` or
`Diff check failed: 1 new finding (--fail-on new-findings)`. In a CI job:

```bash
ipcraft diff bd/system.bd --base origin/main --out diff.md --fail-on new-findings
```

The Markdown report is made for a pull request comment:

```markdown
## System design changes: zynq_gpio_system

Comparing `HEAD` (base) with `working tree`.

**+1 added · −4 removed · ~2 changed · v1 version only · 0 new findings · 1 resolved finding**

### Findings
| | Finding | Where | Detail |
|---|---|---|---|
| Resolved | undriven pin | `led_o` | |

Findings are computed from the design files alone; workspace definitions are not used, so pins of blocks without a known pin list are not checked.

### Address map
| | Address space | Segment | Base | Current |
|---|---|---|---|---|
| − | `sys_ps7/Data` | `axi_gpio_0/S_AXI/Reg` | `0x41200000` · `0x00010000` | |
| ~ | `sys_ps7/Data` | `gpio_block/axi_gpio_1/S_AXI/Reg` | `0x41210000` · `0x00010000` | `0x41220000` · `0x00010000` |

### External ports
| | Port | Base | Current |
|---|---|---|---|
| − | `led_o` | direction `out` · width `7:0` · not connected | |

### Level `/`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| + | `axis_data_fifo_0` | added | | `xilinx.com:ip:axis_data_fifo:2.0` |
| + | `axis_data_fifo_0` | pin `s_axis_aclk` connects to | | `sys_ps7/FCLK_CLK1` |
| ~ | `sys_ps7` | parameter `CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ` | `100` | `150` |

### Level `/gpio_block`
| | Block | Change | Base | Current |
|---|---|---|---|---|
| v | `axi_gpio_1` | version | `xilinx.com:ip:axi_gpio:2.0` | `xilinx.com:ip:axi_gpio:2.1` |
```

The **Findings** section lists what the review of the viewer (the **Unconnected** and
**Clocks** tabs) reports in one revision and not in the other: `New` for a finding only the
current revision has, `Resolved` for one only the base has. A finding is one of

- an `undriven pin` or an `unused pin`, a pin that no net touches on its level. An undriven
  pin is one that something should drive: an input of a block, or an output of the design or
  of a hierarchy, seen from inside. An unused pin is any other pin that no net touches: an
  output of a block, an input of the design or of a hierarchy, or an `inout` or a pin
  without a direction. Its Where is `instanceName/pin` for a block, or the pin name for a
  pin of the design or of a hierarchy;
- a `data crossing` or a `reset crossing`: a connection or a reset whose two ends are on
  different clock domains with no known synchronizer; its Where is `from → to`, and its
  Detail the two clocks and the reason. Crossings that Vivado times (related clocks), crossings
  that are unchecked because a clock is not known, blocks that span domains, and crossings
  that are fine are not findings. A Platform Designer system (`.qsys`, qsys-script) has no
  crossing findings, because Platform Designer inserts the clock crossing adapters itself.

A finding is the same in both revisions when it is the same pin (or the same two ends), so a
renamed net does not make a new finding. A renamed block keeps its findings: they are neither
new nor resolved, and a resolved finding that mentions it uses the new name. The
section is written when at least one finding differs, and the summary line then ends with
`N new findings · M resolved findings`; when only findings differ the report is the summary and this
section rather than `No changes.` `--ignore-version-only` does not filter findings. As in
the viewer, a pin is checked only when the design files list the pins of its block, and
workspace definitions are not used, so pins of blocks without a known pin list are not
checked (the note under the table says so). The JSON report has the same lists in a
`findings` field, `{ "new": [...], "resolved": [...] }`, empty when nothing differs; each
entry has `kind` (`undriven`, `unused`, `dataCrossing`, `resetCrossing`), `level`, and for a
pin `instance` (null for a boundary pin), `pin` and `label`, for a crossing `from`, `to`,
`fromInstance` and `toInstance` (the instance path of each end, null for an external port or a
reset whose source is not known), `fromClock`, `toClock` (left out when the clock is not known)
and `reason`, sorted by kind,
level and label.

Each sign has a meaning: `+` added, `−` removed, `~` changed, `→` renamed,
`»` moved, `v` version only. A section without changes is left out, and a report without any change reads
`No changes.` Connections are compared per pin: a pin whose set of connected pins
changed is listed with the old and the new set (`not connected` for an empty
set), however the nets are named. Only the pin that moved is listed: a pin whose
net gained or lost a neighbour is not reported when the neighbour is a pin of an
added or removed block, and not when its other connections stayed and the
neighbour is the pin that joined or left (a new signal on an existing net lists
the new pin, not every pin on that net). A new or removed block lists its own
connected pins. A pin that is connected to a pin on another level of the
hierarchy (a net of the top level can name a pin of a block inside a hierarchy)
is written with its absolute path, such as `/a/x`. For a hierarchy block
`/h/g1`, `/h/g1/z` is its pin `z` seen from outside and `/h/g1:z` is the same
pin seen from inside. The pins of a hierarchy block are compared from the
outside and from the inside: a row such as ``pin `fin` inside connects to``
lists what the pin is connected to within the hierarchy, with the names relative
to that hierarchy (`fifo/s_axis` there is the block `fifo` inside it), and only
the pin that moved is listed there too. The attributes (direction, signal type,
interface, width) and parameters of external ports and of the pins of a
hierarchy block are compared too, one row per difference; a direction is
compared only when both revisions declare it. For the pins of other blocks only
the connections are compared. The JSON report is the same
change list as data; a `changed` pin or port also carries `gained` and `lost`, the
sorted peers (written like `currentPeers` and `basePeers`) that only the current
revision or only the base has, left out when empty, so a renamed block is neither.

A block is identified by its path, so a renamed block would be one removed and one
added block. In every format (Vivado `.bd` and `write_bd_tcl` script, Platform Designer
`.qsys` and `qsys-script`), the diff pairs them as a rename only when they are the same
block under a new name: the same level, kind, type (version included), parameters and
pin names, and, after the rename is applied to the base, the diff reports no change on
the block (for a hierarchy: nor on anything inside it). Connections to blocks that were
added or removed, and neighbours that only joined or left one of its nets, do not count
as a change of the block. There must be exactly one such removed and one such added
block in the level, so identical candidates are not guessed at, and the pairs are
checked together, so the result does not depend on names. A renamed block is one row,
with the characters that differ in bold, and the address segments and the connections
of other blocks that only differed by the name are not reported; the Base column
shows the names the base had. A block whose address changed is still a rename, and its
segment is shown as changed under the new name. A block that is renamed and also
changed stays removed plus added, and a block moved to another level is not a rename.
In JSON, a rename is an instance with `status` `renamed`, `path` (the new path),
`basePath` (the old one), empty `parameters` and `pins`, and is counted in
`summary.renamed`. The summary line of the Markdown report adds `→N renamed` when N is
not 0:

```markdown
| → | `framebuffer_reader` | renamed | `frambuffer_reader` | `fram`**`e`**`buffer_reader` |
```

After the renames, a removed and an added block are paired as a **move** when they are
the same block under another parent level: the same name, kind, type (version
included), parameters and pin names, each the topmost block of its subtree (neither
lies below another removed or added block), and the only such pair. All pairs are
applied to the base at once, with the block and what is below it under the new path
and the nets staying on their levels, so the pins of the moved block can see other
neighbours. A pair is kept when nothing differs below the moved block and the block
itself has no change but its pins (no parameter, type or attribute change); the
others stay removed plus added, as does a block that is moved and renamed, or moved
into a hierarchy that is itself new. A move is one row in the new level, with the old
path under Base and the new path under Current, followed by the rows of the pins whose
connections changed, written as for a changed block; the pins of the blocks that were
connected to it are listed from their side, as for any rewired pin. In JSON, a move
is an instance with `status` `moved`, `path` (the new path), `basePath` (the old one),
`level` (the new parent level), empty `parameters` and the changed `pins`, and is
counted in `summary.moved`; `summary` has the key with 0 when there is no move. The
summary line of the Markdown report adds `»N moved` when N is not 0, and `--fail-on
changes` counts a move as a change:

```markdown
| » | `framebuffer_reader` | moved | `/framebuffer_reader` | `/video/framebuffer_reader` |
| ~ | `framebuffer_reader` | pin `M_AXI` connects to | `axi_interconnect_0/S00_AXI` | `S_AXI_FB` |
```

If the two files are of different formats, for example a `write_bd_tcl` script
and a `.bd` of the same design, the report says so, because each format knows
different things about the design (a `.bd` declares the pins of module
references, a script lists only the pins it connects).

Both revisions are read as text and nothing is executed, as in the viewer. The
revision is read from the local git object store with `git show`; there is no
network access and nothing is checked out.

Limits for now: workspace definitions (`.ip.yml`, HDL, `.qsys`) are not used, so
only the pins the design files list are compared. A file that does not exist at
the base revision is an error (`'<file>' does not exist at <ref>`, followed by
git's own reason), not a design with everything added, and a file that was
renamed or moved between the revisions is not followed. The path given to
`git show` is the spelling on the command line, so on a case-insensitive file
system a path with the wrong case is found on disk but not at the revision. A
file stored with Git LFS is read as its pointer text and reported as not a
recognized system design. The concept is in
[System Design Diff](../concepts/brainstorm/system-design-diff.md).

## Upgrade files to the latest format

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

### Convert legacy snake_case keys

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

## Generate a vhdl_ls.toml

```bash
ipcraft vhdl-ls --root . --dry-run
```

`--dry-run` prints the file instead of writing it, and `--force` replaces a
`vhdl_ls.toml` that IPCraft did not write (the old file is saved to
`.ipcraft/backup/`). See [Generating a vhdl_ls.toml](../how-to/generate-vhdl-ls-config.md).

## Build the npm package

The standalone `ipcraft` npm package remains unpublished and separate. Contributors
can build a local package archive and install it in a clean environment:

```bash
npm run package:cli
npm install --global ./build/ipcraft-<version>.tgz
ipcraft generate path/to/core.ip.yml --target quartus --lang vhdl --out gen/
```
