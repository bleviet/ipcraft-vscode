# Generated VHDL-LS Configuration

## Status

Draft concept. This document proposes behavior that does not exist today. It
describes the minimum viable product (MVP) only; later features are listed in
[Deferred](#deferred) and are not part of this scope.

## Problem

Users want to navigate VHDL source in VS Code: go to definition, find
references, hover. The VHDL language server rust_hdl (VHDL-LS) provides this,
but only when its `vhdl_ls.toml` maps every source file to a VHDL library. In a
large FPGA repository with many IP cores this file is missing, written by hand
for one core, or out of date:

- names used across cores (`use dsp_lib.fir_pkg.all;`) do not resolve;
- the same unit in two places (Vivado `import_files` copies, generated output,
  a shared `fifo` in several cores) produces duplicate-unit errors;
- vendor and verification libraries (UNISIM, OSVVM, VUnit) are unknown, so
  every file that uses them shows errors.

The library mapping already exists in the repository, spread over vendor
project files that IPCraft can read statically.

## Goal

One explicit command, in the VS Code UI and in the CLI, writes one
`vhdl_ls.toml` at the workspace root so that rust_hdl resolves names across all
cores in the repository.

| Goals | Non-goals for the MVP |
|---|---|
| Generate a root `vhdl_ls.toml` from the files in the repository | Changing `ipcraft-spec` or the `.ip.yml` schema |
| Same result from the command palette and the CLI | Any IPCraft navigation feature (links, CodeLens, hover) |
| Never lose a user-written configuration or user additions | Running automatically: on open, on save, or by a file watcher |
| Propose, as comments, the libraries IPCraft cannot find | Resolving `.qsys` or block designs, or running a vendor tool |
| Stay fast on repositories with thousands of VHDL files | Verilog and SystemVerilog (rust_hdl is VHDL only) |

## How rust_hdl Reads Its Configuration

These facts constrain the design:

| Fact | Consequence |
|---|---|
| The VS Code extension loads `~/.vhdl_ls.toml`, then the file named by `VHDL_LS_CONFIG`, then `vhdl_ls.toml` in the workspace root; a library in a later file redefines the same library from an earlier one | The root file is the only slot IPCraft may write. The home file affects every project, and IPCraft cannot set the environment of another extension's server |
| There is no setting for a configuration path (rust_hdl_vscode #105, open) | IPCraft cannot point rust_hdl at a generated file elsewhere |
| Only one `vhdl_ls.toml` is active per workspace; nested files are not discovered, and LSP workspace folders are not supported (rust_hdl #341 and #385, open) | Nested `vhdl_ls.toml` files have no effect. Multi-root workspaces cannot be served reliably |
| All configured files share one namespace per library; a unit declared twice in a library is an error, and go to definition reaches only the first of two packages with the same name | Duplicate units must be removed from the generated mapping |
| File names are absolute or relative to the directory of `vhdl_ls.toml`; globs and `exclude` patterns are supported | Generated paths are relative; the user section may use globs |
| Files outside the configuration are still analyzed on their own by default (`vhdlls.nonProjectFiles: analyze`) | A new file is not invisible before the next generation, only outside any library |

## User Workflow

The user runs the command explicitly. The first generation and every
regeneration are started by the user; nothing runs in the background.

1. The user opens a folder and runs **IPCraft: Generate vhdl_ls.toml** from the
   command palette, or runs `ipcraft vhdl-ls` in a terminal.
2. IPCraft reads the repository, builds the library mapping, and writes
   `vhdl_ls.toml` at the root. When an existing file was not written by IPCraft,
   it backs that file up and asks first (see [Ownership](#ownership)).
3. A summary names the number of libraries and files, the excluded duplicates,
   and the missing libraries. **Open** shows the file.
4. For each missing library, the user section of the file contains a commented
   proposal. The user fills in the path, uncomments it, and runs the command
   again.
5. After a structural change (a new core, moved files, a renamed library), the
   user runs the command again.

| Workspace | Behavior |
|---|---|
| Single folder | Writes `<folder>/vhdl_ls.toml` |
| Multi-root workspace | Warns that rust_hdl uses only one configuration, then asks which folder to write to |
| Untrusted workspace | The command is not available, consistent with the system viewer, which reads no definition files there |

## Library Sources

Sources are ranked. Rank 1 always states a VHDL library, rank 2 and rank 4
state one when the entry carries a logical name, and rank 3 never does. A
source that states no library still declares that a file belongs to a core:
its rank counts when duplicates are resolved, so a file a core declares beats a
stray copy that nothing declares.

| Rank | Source | What it gives |
|---|---|---|
| 1 | Vivado project `.xpr` | `File` entries of all file sets, with the `Library` attribute; paths with `$PPRDIR` (the project directory) or `$PSRCDIR` (`<project>.srcs`), or relative to the `.xpr`; other variables are skipped and counted. An entry without the attribute states Vivado's default library |
| 1 | Quartus `.qsf` and `.qip` | `set_global_assignment -name VHDL_FILE <path> -library <lib>`, in any flag order; paths relative to the file. Every `.qip` under the root is read, so `QIP_FILE` references need not be followed. The common `[file join $::quartus(qip_path) "<file>"]` form is recognized; other Tcl expressions are skipped and counted. An assignment without `-library` states Quartus' default library |
| 2 | `component.xml` | `spirit:file` entries, with the library from `spirit:logicalName` when present, for packaged IP |
| 3 | Platform Designer `_hw.tcl` | `add_fileset_file` entries, including those in procs and in `source`d scripts, read with the Tcl helpers of `HwTclParser`; paths relative to the `_hw.tcl` file. No library |
| 4 | IPCraft `.ip.yml` | VHDL files of the `fileSets`, with the library from the file's `logicalName` when present; paths relative to the `.ip.yml` file |
| 5 | Unlisted | Every other VHDL file under the root. Default library |

Rules:

- **The highest library-stating rank decides the library.** A file named by a
  rank 1 and a rank 2 source gets the rank 1 library. A file whose sources
  state no library gets the default library.
- **The highest rank overall decides duplicates** and the provenance comment
  (see [Scanning](#scanning)).
- **Same-rank disagreement keeps both.** When two sources of the same rank name
  different libraries for one file (for example two `.xpr` files), the file is
  listed in both libraries, with a comment. rust_hdl allows a file in several
  libraries, and this is faithful to both projects.
- **Only files under the root are mapped.** A source entry that points outside
  the root, or to a file that does not exist, is reported in the summary and
  not written.

### Default Library

The default library is named `defaultlib`. Every file without a stated library
goes there. The vendor default names are mapped to it as well: a stated
`xil_defaultlib` (Vivado's default, which IPCraft's own generated
`component.xml` writes for every file) or `work` (Quartus' default) becomes
`defaultlib`, from any source. Otherwise a core packaged for Vivado would land
in `xil_defaultlib` while the other cores land in `defaultlib`, and
`use work.<unit>` between them would no longer resolve. The cost is that code
writing `use xil_defaultlib.<unit>` does not resolve.

The name cannot be `work`: rust_hdl rejects it, and the whole configuration
fails to load ("The 'work' library is not a valid library", with the hint to
use a common name such as `defaultlib`). `work` semantics need no library of
that name. In VHDL, `work` is the library of the file that uses it, so
`use work.fifo_pkg.all;` resolves the same way in `defaultlib`. The name only
matters to code that writes `use defaultlib.<unit>`.

`.qsys` files are not read in the MVP. A `.qsys` names component kinds, not
files; turning a kind into its `_hw.tcl` needs the Quartus IP search paths
(`IP_SEARCH_PATHS` in the `.qsf`, `.ipx` index files). The only gain would be
deciding between two `_hw.tcl` files for the same component (for example two
versions), which the duplicate rule already settles deterministically. It is
the first follow-up if real repositories show that case.

### Generated Output

Generated directories are excluded from the scan and from the mapping, using
the same list as system viewer enrichment, extended for Platform Designer:

- `node_modules`, `.git`, `.ipcraft`;
- Vivado: `*.gen`, `*.cache`, `*.ip_user_files`, `*.runs`, `*.sim`, `.Xil`;
- Platform Designer: `<name>/synthesis` and `<name>/simulation` next to a
  `<name>.qsys`.

This needs no `.qsys` or block design reader. A `.qsf` that names only a
`.qsys` contributes no files; the components that system uses are mapped
anyway, from their `_hw.tcl` (rank 3) or as unlisted files under the root.
Generation copies those sources into `<name>/synthesis/submodules`, and the
exclusion keeps the copies from becoming duplicates. `.qip` files inside
excluded directories are not read.

## Scanning

Each mapped VHDL file is read once by a light scanner, not by `VhdlParser`. It
strips comments and string literals and records:

- primary units: `entity`, `package`, `configuration`, `context`;
- `library <name>;` clauses, with line numbers;
- `use <lib>.<unit>` clauses, with line numbers;
- direct `entity <lib>.<unit>` and `configuration <lib>.<unit>` instantiations
  and binding indications, with line numbers.

Files over 1 MiB are mapped but not scanned, and are counted in the summary.
The workspace is listed in one directory walk, the same in VS Code and the
CLI, and files are read with a small concurrent pool. No
cache is kept; the command is explicit, so a run of a few seconds on a large
repository is acceptable. If real repositories are slower, a cache is the first
follow-up.

The scan feeds two rules.

**Duplicate units.** When two files in the same library declare the same
primary unit, one is kept: the one from the higher-ranked source, then the one
with the shorter path, then the first in path order. The others are written as
comments in that library (`# excluded: duplicate of entity fifo in
cores/common/fifo.vhd`) and listed in the summary. Excluded files are not
navigable; this is the cost of a working namespace.

**Missing libraries.** A library named in a `library` clause that is neither
generated, defined in the user section, nor standard (`ieee`, `std`, `work`)
is missing. Each missing library gets a commented proposal in the user section
(see [Proposals](#proposals-for-missing-libraries)).

## File Layout

```toml
# Generated by IPCraft. Regenerate with "IPCraft: Generate vhdl_ls.toml"
# or `ipcraft vhdl-ls`. Edit only the user section at the end.
# ipcraft-generated sha256=3f9c0b7e...

# ==== IPCraft generated section ====
libraries.defaultlib.files = [
  'cores/common/fifo.vhd',      # cores/common/common.ip.yml
  'cores/uart/rtl/uart.vhd',    # cores/uart/uart_hw.tcl
  'cores/uart/tb/uart_tb.vhd',  # unlisted
  # excluded: cores/uart/old/fifo.vhd, duplicate of entity fifo in cores/common/fifo.vhd
]
libraries.dsp_lib.files = [
  'cores/fir/rtl/fir.vhd',      # cores/fir/fir.xpr
  'cores/fir/rtl/fir_pkg.vhd',  # cores/fir/fir.xpr
]
# ==== End of IPCraft generated section ====

# ==== User section: IPCraft only appends proposals here ====
# Missing library osvvm, used by cores/uart/tb/uart_tb.vhd:5 and 3 other files.
# Packages it should provide were found in: ext/OsvvmLibraries/osvvm/
# [libraries.osvvm]
# files = ['ext/OsvvmLibraries/osvvm/*.vhd']
# is_third_party = true

# Missing library unisim, used by cores/fir/rtl/fir.vhd:3.
# Path from ipcraft.vivado.installDirs (2024.2):
# [libraries.unisim]
# files = ['/tools/Xilinx/Vivado/2024.2/data/vhdl/src/unisims/unisim_VCOMP.vhd']
# is_third_party = true
```

Layout decisions:

- **Dotted keys, no `[libraries]` header.** The generated section uses
  `libraries.<name>.files` at the top level. A TOML table header cannot be
  repeated, and keys after a header belong to that table. Dotted keys let the
  user section come last and still add libraries (`libraries.osvvm.files`, or a
  `[libraries.osvvm]` sub-table) and top-level tables such as `[lint]`.
- **Explicit file lists.** The generated section lists files, never globs.
  Globs over core directories would pick up copies, variants, and testbenches
  again.
- **One provenance comment per file.** It names the highest-ranked source
  file, or `unlisted`.
- **Deterministic output.** Libraries are sorted by name and files by path, so
  the same repository always produces the same bytes. A second run with no
  changes rewrites nothing.
- **No top-level options in the generated section.** `standard`,
  `preferred_case`, and `[lint]` belong to the user section.
- **Library names** are written as bare keys when valid and quoted otherwise.

## The User Section

Everything after the user section marker belongs to the user. It is the only
place for hand edits, so a user's additions are never lost. IPCraft never
changes or removes a line there; the only thing it does is append a proposal
for a library that is missing and not yet proposed (see
[Proposals](#proposals-for-missing-libraries)).

IPCraft parses the user section and treats it as the highest-ranked source,
because a person stated it:

- a library the user section defines is never written in the generated
  section, which also avoids defining one TOML key twice;
- a file matched by a user-section library (its `files` patterns, minus its
  `exclude` patterns, relative to the root) is removed from the generated
  libraries;
- a library the user section defines is not reported as missing.

When the user section does not parse as TOML, IPCraft writes nothing, and the
error names the line.

## Proposals for Missing Libraries

Each proposal is a commented block appended to the user section:

- a first line `# Missing library <name>, used by <file>:<line>`, plus a count
  of the other files;
- if the scan found files declaring the units referenced from that library (for
  example `use osvvm.OsvvmGlobalPkg.all` and a file declaring
  `package OsvvmGlobalPkg`, or `entity neorv32.psram_model` and a file
  declaring `entity psram_model`), the directories of those files;
- a `files` line, with the path chosen in the order below, and
  `is_third_party = true` for known vendor and verification libraries.

The path of the `files` line is, in order:

1. for a vendor library, the files in the configured Vivado or Quartus
   installation (see [Vendor Libraries](#vendor-libraries));
2. the directory found in the workspace;
3. a placeholder path.

| Library family | Names | `is_third_party` |
|---|---|---|
| AMD | `unisim`, `unimacro`, `xpm` | yes |
| Intel | `altera_mf`, `altera_lnsim`, `lpm`, `altera` | yes |
| Verification | `osvvm`, `vunit_lib`, `uvvm_util`, `uvvm_vvc_framework` | yes |
| Any other name | | no |

Rules:

- **Proposals stay commented,** even when a path is known. An installation
  path is machine-specific, and a workspace path may be wrong; the user decides.
- **Table form.** A proposal uses a `[libraries.<name>]` table header, not
  dotted keys. The user section may already contain a table such as `[lint]`,
  and a dotted `libraries.<name>.files` line after it would belong to that
  table and break the configuration; a table header is valid anywhere at the
  end of the file.
- **Append once.** A proposal is appended only when the library is missing and
  the user section has no `# Missing library <name>` line yet. Uncommenting the
  proposal in place defines the library, so it is no longer missing. A proposal
  that is no longer needed stays until the user deletes it.
- **No guessed excludes.** Libraries such as VUnit ship files for several VHDL
  standards; the proposal says so in a comment, without guessing the `exclude`
  pattern.

### Vendor Libraries

When the Vivado or Quartus installation is configured in IPCraft, the proposal
for a vendor library names the files in that installation.

- **Settings.** `ipcraft.vivado.installDirs` and `ipcraft.quartus.installDirs`,
  falling back to the deprecated `installDir`. With several versions, the one
  matching `pinnedVersion` is used, otherwise the latest by folder name. The
  comment names the setting and the version.
- **File system only.** Vivado directories are resolved with the existing
  `resolveVivadoInstallDir`; Quartus `installDirs` entries are already version
  directories. No vendor process is started, so the existing Quartus resolver,
  which runs `quartus_sh --version`, is not used.
- **Only existing files.** Each file below is proposed only if it exists, so a
  Docker runner, a missing installation, or a different layout in another
  release falls back to the next path source.
- **Component declarations, not models.** For UNISIM the proposal is the
  component package, as in the rust_hdl README. Navigation reaches the
  component declaration, and rust_hdl does not analyze thousands of primitive
  models.

| Library | Installation | Files, relative to the version directory |
|---|---|---|
| `unisim` | Vivado | `data/vhdl/src/unisims/unisim_VCOMP.vhd` |
| `unimacro` | Vivado | `data/vhdl/src/unimacro/unimacro_VCOMP.vhd` |
| `xpm` | Vivado | `data/ip/xpm/xpm_VCOMP.vhd` |
| `altera_mf` | Quartus | `quartus/eda/sim_lib/altera_mf_components.vhd`, `quartus/eda/sim_lib/altera_mf.vhd` |
| `lpm` | Quartus | `quartus/eda/sim_lib/220pack.vhd`, `quartus/eda/sim_lib/220model.vhd` |
| `altera` | Quartus | `quartus/eda/sim_lib/altera_primitives_components.vhd`, `quartus/eda/sim_lib/altera_primitives.vhd` |
| `altera_lnsim` | Quartus | `quartus/eda/sim_lib/altera_lnsim_components.vhd` |

The table is checked against the installed releases used by the Vivado and
Quartus integration tests when it is implemented.

The CLI reads no VS Code settings, so it writes the workspace directory or a
placeholder. The UI and the CLI therefore differ only inside commented
proposals; the generated section is identical.

## Ownership

IPCraft decides what it may overwrite from the header line
`# ipcraft-generated sha256=<hash>`. The hash covers the bytes of the generated
section between its two markers, with line endings normalized to LF. Edits in
the user section do not change it.

| Existing root file | Action |
|---|---|
| None | Write the file, with an empty user section |
| IPCraft header, hash matches | Overwrite the generated section without asking; keep the user section |
| IPCraft header, hash differs or markers missing (the generated section was edited) | Treat as a user file |
| No IPCraft header (written by a user) | Treat as a user file |

For a user file:

1. **Back up** the file to `.ipcraft/backup/vhdl_ls.<timestamp>.toml`. The
   backup is taken even when git tracks the file.
2. **Ask** in the UI with a modal: replace (the backup path is named) or cancel.
   The CLI refuses without `--force` and exits with code 2.
3. **Write** the new file with an empty user section whose first comment names
   the backup, so the user can copy entries back.

The old content is not merged, because IPCraft cannot tell which of its entries
are still valid.

## CLI

```text
ipcraft vhdl-ls [--root <dir>] [--dry-run] [--force]
```

| Option | Effect |
|---|---|
| `--root <dir>` | Folder to read and write `vhdl_ls.toml` in; default is the current directory |
| `--dry-run` | Print the file to stdout and the summary to stderr; write nothing |
| `--force` | Replace a user file (after the backup) without asking |

Exit codes: `0` written or unchanged, `1` error (for example an unparsable user
section), `2` refused because a user file exists and `--force` is missing.

## Architecture

The UI command and the CLI share one core. Effects stay at the edges; the
ranking, the duplicate rule, the rendering, and the ownership decision are pure
functions over typed inputs.

| Module | Responsibility |
|---|---|
| `src/services/vhdlLsConfig/workspaceWalk.ts` | One directory walk with the generated-directory exclusions |
| `src/services/vhdlLsConfig/sourceReaders.ts` | Readers for `.xpr`, `.qsf` / `.qip`, `component.xml`, `_hw.tcl` and `.ip.yml` file entries (`@xmldom/xmldom` and `js-yaml` are already dependencies) |
| `src/parser/tclPathWord.ts` | Tcl path word (`[file join ...]`, `$::quartus(qip_path)`), extracted from `HwTclParser` and shared with it |
| `src/services/vhdlLsConfig/userSection.ts` | Parse the user section; match its `files` and `exclude` patterns |
| `src/services/vhdlLsConfig/vendorLibraries.ts` | Vendor library file table and the configured installation |
| `src/services/vhdlLsConfig/vhdlUnitScanner.ts` | Light scanner: units, `library` and `use` clauses |
| `src/services/vhdlLsConfig/buildLibraryMap.ts` | Pure: sources plus scan results plus user section to libraries, duplicates, missing libraries |
| `src/services/vhdlLsConfig/renderVhdlLsToml.ts` | Pure: library map to file text, header hash, proposals |
| `src/services/vhdlLsConfig/ownership.ts` | Pure: classify an existing file; split it into the generated and user sections |
| `src/services/vhdlLsConfig/generateVhdlLsConfig.ts` | Orchestration: walk, read, build, render, backup and write |
| `src/commands/VhdlLsConfigCommands.ts` | VS Code command: folder choice, trust, modal, summary |
| `src/cli/vhdlLs.ts` | CLI entry and argument handling |

The generated-directory list is shared with system viewer enrichment
(`src/services/systemDiagram/enrichment/workspaceFilter.ts`) rather than copied.

## Testing

| Level | Coverage |
|---|---|
| Unit | Each reader on small inputs; the scanner (comments, strings, case); ranking, same-rank disagreement, duplicates (a declared file beats an unlisted copy), and user-section precedence in `buildLibraryMap`; the ownership table; proposals (append once, vendor files only when they exist, fallback order); rendering determinism and TOML validity of the output |
| Snapshot | Rendered `vhdl_ls.toml` for four fixtures: a single core; several cores with cross-library `use`; a `.qsf` that names only a `.qsys`, with generated Platform Designer output present; an existing user-written `vhdl_ls.toml` |
| Integration | On the multi-core fixtures, `vhdl_lang -c vhdl_ls.toml` (the rust_hdl command-line frontend, which reads the same configuration as the language server) reports no diagnostics, so every cross-core name resolves; removing one generated library makes it fail. Tier 2: skipped when `vhdl_lang` is not installed, unless `REQUIRE_VHDL_LANG=1` |

Done when the snapshot and integration tests pass, a second run is
byte-identical, and the user section survives regeneration.

## Deferred

Not part of the MVP:

| Area | Items |
|---|---|
| Navigation | Links from block design Tcl and `_hw.tcl` to HDL, CodeLens and hover from the system graph, reveal in the system diagram |
| UI | HDL Libraries view, quick fixes, status bar item, first-open notification, diff preview before replacing |
| Background | File watcher, automatic regeneration, persistent scan cache |
| Sources | `.qsys` resolution to `_hw.tcl` through the IP search paths, block design resolution, tool-exported compile orders, FuseSoC `.core`, project Tcl scripts, nested `vhdl_ls.toml` files, carrying `.qip` libraries from generated copies to their originals |
| Mapping | Library inference from `use` clauses beyond commented proposals, scoping to one top |
| Other outputs | `--check` for CI, Verible and slang file lists |

## Decisions

| Decision | Outcome |
|---|---|
| TOML parser for the user section | `toml` (BinaryMuse/toml-node) 5.x. MIT, TOML v1.1.0 (702 of 708 toml-test cases), no runtime dependencies, parse errors carry `line` and `column`, ships TypeScript types, Node 20 or later. Only parsing is needed, since IPCraft renders the file itself. `smol-toml` is faster but BSD-3-Clause, and `confbox` is MIT but bundles `smol-toml` |
| Default library name | `defaultlib`; see [Default Library](#default-library) |
| CLI command name | `ipcraft vhdl-ls` |
| Restarting rust_hdl after a write | Not in the MVP. IPCraft writes the file and does nothing else; restarting the language server is left to the user |
| Vendor library paths | Proposed, commented, from the configured Vivado or Quartus installation when set; otherwise the same as OSVVM and the others. See [Vendor Libraries](#vendor-libraries) |

## References

- [VHDL-LS/rust_hdl](https://github.com/VHDL-LS/rust_hdl): configuration format
- [VHDL-LS/rust_hdl_vscode](https://github.com/VHDL-LS/rust_hdl_vscode): configuration lookup order and settings
- [rust_hdl_vscode #105](https://github.com/VHDL-LS/rust_hdl_vscode/issues/105): custom configuration path
- [rust_hdl #341](https://github.com/VHDL-LS/rust_hdl/issues/341): several projects in one workspace
- [rust_hdl #385](https://github.com/VHDL-LS/rust_hdl/issues/385): projects that share files
- [Offline System Viewer](offline-system-viewer.md): the generated-directory exclusions this concept shares
