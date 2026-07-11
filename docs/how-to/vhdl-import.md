# Importing from Existing Files

How to reverse-engineer existing hardware description files into IPCraft specifications.

IPCraft can import from three source formats:

| Source | Command | Output |
|--------|---------|--------|
| VHDL entity (`.vhd`, `.vhdl`) | `IPCraft: Import from VHDL (Experimental)` | `.ip.yml` |
| Altera Platform Designer (`_hw.tcl`) | `IPCraft: Import from Altera Platform Designer (Experimental)` | `.ip.yml` |
| Xilinx IP-XACT (`component.xml`) | `IPCraft: Import from Xilinx Component XML (Experimental)` | `.ip.yml` (+ `.mm.yml` if registers found) |

---

## Importing from VHDL

### Prerequisites

- A `.vhd` or `.vhdl` file containing a VHDL entity declaration

### How to trigger

**Command Palette:**

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run `IPCraft: Import from VHDL (Experimental)`
3. Select the VHDL file from the file picker

**IPCraft application menu:**

Open the **IPCraft** top-level menu → **Import** group → **Import from VHDL (Experimental)**

**Editor title bar:**

Open a `.vhd` or `.vhdl` file → click the **Import from VHDL (Experimental)** icon in the title bar

### What gets imported

| VHDL construct | IPCraft field |
|----------------|---------------|
| Entity name | `vlnv.name` |
| `generic` declarations | `parameters` (name, type, default value) |
| Ports ending in `clk`, `clock`, `aclk` | `clocks` (with `associatedReset` when unambiguous) |
| Ports ending in `rst`, `reset`, `rst_n`, `aresetn` | `resets` (polarity auto-detected; `associatedClock` set when unambiguous) |
| Remaining port declarations | `ports` (direction, width, logical name) |
| Bus port patterns | `busInterfaces` (type, mode, physical prefix, `associatedClock`, `associatedReset`) |

**Bus interface detection:** The parser scores every candidate signal-name prefix against all supported bus definitions and picks the best-matching bus type for each prefix. A pollution check rejects prefixes whose unrecognized sibling signals outnumber the matched bus signals, which prevents false-positive matches (e.g. a `rd_data`/`rd_valid` pair triggering an Avalon-ST hit when `rd_en` and `rd_addr` are also present).

| Bus type | Min matched signals | Disambiguation |
|----------|:------------------:|----------------|
| **AXI4-Full** | 8 | Requires at least one exclusive signal (`awlen`, `awburst`, `wlast`, `rlast`) |
| **AXI4-Lite** | 4 | Matched when AXI4-Full exclusive signals are absent |
| **AXI-Stream** | 2 | `tvalid` + `tdata` (or `tvalid` + `tready`) |
| **Avalon-MM** | 3 | `address` + `read`/`write` + `readdata`/`writedata` |
| **Avalon-ST** | 2 | `valid` + `data` (rejected if pollution ratio is high) |

The prefix (e.g., `s_axi_`) is set as `physicalPrefix`. When the module has exactly one clock and one reset port, `associatedClock` and `associatedReset` are set on all detected bus interfaces automatically.

**Port widths:**

- `std_logic` → width `1`
- `std_logic_vector(N downto 0)` → width `N+1`
- `std_logic_vector(PARAM-1 downto 0)` → parameterized width referencing the generic name

### Output

Creates `<entity_name>.ip.yml` in the same directory as the source VHDL file. Opens the file in the IP Core visual editor after import.

### Post-import steps

1. Review and refine the VLNV metadata (vendor, library, version)
2. Add `memoryMapRef` to any bus interfaces that should have register maps
3. Create a corresponding `.mm.yml` file if your IP has registers
4. Fill in descriptions for clocks, resets, and ports

---

## Importing from Platform Designer (`_hw.tcl`)

### Prerequisites

- An Altera `_hw.tcl` file (Quartus Platform Designer IP specification)

### How to trigger

**Command Palette:**

1. Run `IPCraft: Import from Altera Platform Designer (Experimental)`
2. Select the `_hw.tcl` file from the file picker

**IPCraft application menu:**

Open the **IPCraft** top-level menu → **Import** group → **Import from Altera Platform Designer (Experimental)**

**Editor title bar:**

Open a `_hw.tcl` file → click the import icon in the title bar

### Output

Creates `<component_name>.ip.yml` in the same directory as the `_hw.tcl` file.

---

## Importing from Vivado IP-XACT (`component.xml`)

### Prerequisites

- A Xilinx `component.xml` file (Vivado IP-XACT descriptor)

### How to trigger

**Command Palette:**

1. Run `IPCraft: Import from Xilinx Component XML (Experimental)`
2. Select the `component.xml` file from the file picker

**IPCraft application menu:**

Open the **IPCraft** top-level menu → **Import** group → **Import from Xilinx Component XML (Experimental)**

**Editor title bar:**

Open `component.xml` → click the import icon in the title bar

### Output

Creates `<component_name>.ip.yml` in the same directory. If the `component.xml` contains register data (memory maps), a `<component_name>.mm.yml` is also created and linked via `memoryMapRef`.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `ipcraft.import.vendor` | `"user"` | Vendor name to assign. `"user"` auto-detects from `git user.email` domain. |
| `ipcraft.import.library` | `"ip"` | Default library name. |
| `ipcraft.import.version` | `"1.0.0"` | Default version string. |
