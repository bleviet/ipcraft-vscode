# Generating a vhdl_ls.toml

The VHDL language server rust_hdl (the VHDL-LS extension) provides go to
definition, find references and hover for VHDL, but only when its
`vhdl_ls.toml` maps every source file to a VHDL library. IPCraft writes that
file for you from the project files already in your repository, so names
resolve across all IP cores.

## Prerequisites

- The VHDL-LS extension, or `vhdl_ls` used by another editor
- A trusted workspace (the command is not available in Restricted Mode)

## Generate the file

In VS Code, run **IPCraft: Generate vhdl_ls.toml** from the Command Palette.
In a terminal, run:

```bash
ipcraft vhdl-ls [--root <dir>] [--dry-run] [--force]
```

| Option | Effect |
| --- | --- |
| `--root <dir>` | Folder to read and write `vhdl_ls.toml` in (default: the current directory) |
| `--dry-run` | Print the file instead of writing it |
| `--force` | Replace a `vhdl_ls.toml` that IPCraft did not write, after saving a backup |

The file is written at the root of the folder. rust_hdl reads only that one
file, so in a multi-root workspace IPCraft asks which folder to use.

IPCraft never runs on its own. Run the command again after you add a core,
move files or rename a library. If rust_hdl does not pick up the new file,
restart the language server.

## Where the libraries come from

IPCraft reads the files that state a library, in this order:

| Source | Library |
| --- | --- |
| Vivado `.xpr`, Quartus `.qsf` and `.qip` | The library of each file in the project |
| `component.xml` | The `logicalName` of each file |
| `_hw.tcl` | None; the files are known to belong to a core |
| `.ip.yml` | The `logicalName` of each file in `fileSets`, if set |

Every other VHDL file in the folder goes into the library `defaultlib`, and so
do files whose library is Vivado's `xil_defaultlib` or Quartus' `work`.
`use work.<unit>` resolves the same way in `defaultlib`. Code that names
`xil_defaultlib` explicitly (`use xil_defaultlib.<unit>`) does not resolve this
way; IPCraft proposes the library instead (see below).

Generated output (`*.gen`, `*.ip_user_files`, `.Xil`, the `synthesis` and
`simulation` folders Platform Designer writes next to a `.qsys`, and similar)
is left out, so its copies do not collide with your sources.

When two files declare the same entity or package in one library, IPCraft
keeps one: the one a project file or core names, otherwise the one with the
shorter path. Between otherwise equal copies, one that needs a library
IPCraft does not know (for example a `nvc` variant) loses. Template files that
contain `${...}` placeholders are never kept. The others appear as
`# excluded:` comments in the file. An unlisted file whose units are all
provided by a library in your user section (for example OSVVM `deprecated/`
copies) is excluded the same way, and your library wins, unless another file
in the default library uses that copy.

Test environments often reuse names, for example one `TestCtrl` entity in each
testbench folder, with test-case files that each bind to their own folder's
copy. When files no project names declare the same unit in different folders,
IPCraft gives each group of related folders a library of its own, named after
the folder, and lists the files it needs from `defaultlib` in it too:

```toml
libraries.defaultlib_uart.files = [
  'uart/testbench/TestCtrl_e.vhd',  # unlisted
  'uart/TestCases/Tc1.vhd',  # unlisted
  'common/util_pkg.vhd',  # shared from defaultlib
]
```

A group that a file left in `defaultlib` depends on stays in `defaultlib`, so
nothing there loses a unit. A test case written for a sibling testbench binds
to the nearer folder.

When a file uses `work.<unit>` and only a file in another library declares that
unit, the declaring file is also listed in the library of the file that uses
it, marked `# shared from <library>`. The separate package body or architecture
files of that unit come along, and so do the units it needs from the same
library. A file is skipped when those would clash with a same-named unit the
library already has from elsewhere. This covers `defaultlib` and the per-folder
libraries, and also takes files from libraries you define in the user section,
which IPCraft itself never changes.

## The user section

The end of `vhdl_ls.toml` is yours. IPCraft never changes what you write there,
and settings such as `standard = "2008"` or a `[lint]` table belong there. A
library you define there replaces the one IPCraft would generate.

When your code uses a library that IPCraft cannot find, such as `osvvm`,
`vunit_lib` or `unisim`, it adds a commented proposal to the user section:

```toml
# Missing library osvvm, used by cores/uart/tb/uart_tb.vhd:5 and 3 other files.
# Packages it should provide were found in: ext/OsvvmLibraries/osvvm/
# [libraries.osvvm]
# files = ['ext/OsvvmLibraries/osvvm/*.vhd']
# exclude = ['ext/OsvvmLibraries/osvvm/OsvvmSettingsPkg_template.vhd']
# is_third_party = true
```

The `exclude` line lists files inside those folders that would break the
library: files that add no unit beyond what another file already declares, template files,
files another library of your user section already covers, and files a user `exclude` removed.

Check the path, remove the `# ` from the `[libraries...]`, `files`, `exclude` and
`is_third_party` lines (the ones present), and run the command again. In VS Code, if the
Vivado or Quartus installation is set in the IPCraft settings, proposals for
vendor libraries such as `unisim` or `altera_mf` name the files in that
installation; the CLI proposes a directory found in the workspace or a
placeholder path instead.

## An existing vhdl_ls.toml

| Existing file | What happens |
| --- | --- |
| Written by IPCraft and not edited outside the user section | Replaced; the user section is kept |
| Written by you, or IPCraft's part was edited | IPCraft asks first (the CLI needs `--force`), saves a copy to `.ipcraft/backup/`, then writes a new file |

The new file names the backup in its user section, so you can copy settings
back.
