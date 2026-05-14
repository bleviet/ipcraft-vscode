# Importing from Existing Files

How to reverse-engineer existing hardware description files into IPCraft specifications.

IPCraft can import from three source formats:

| Source | Command | Output |
|--------|---------|--------|
| VHDL entity (`.vhd`, `.vhdl`) | `IPCraft: Parse VHDL to .ip.yml` | `.ip.yml` |
| Altera Platform Designer (`_hw.tcl`) | `IPCraft: Parse Altera Platform Designer Component (_hw.tcl) to .ip.yml` | `.ip.yml` |
| Xilinx IP-XACT (`component.xml`) | `IPCraft: Parse Xilinx component.xml to .ip.yml` | `.ip.yml` (+ `.mm.yml` if registers found) |

---

## Importing from VHDL

### Prerequisites

- A `.vhd` or `.vhdl` file containing a VHDL entity declaration

### How to trigger

**Command Palette:**

1. Open the Command Palette (`Ctrl+Shift+P`)
2. Run `IPCraft: Parse VHDL to .ip.yml`
3. Select the VHDL file from the file picker

**Explorer context menu:**

Right-click a `.vhd` or `.vhdl` file → **IPCraft: Parse VHDL to .ip.yml**

**Editor title bar:**

Open a `.vhd` or `.vhdl` file → click the **Parse VHDL to .ip.yml** icon in the title bar

### What gets imported

| VHDL construct | IPCraft field |
|----------------|---------------|
| Entity name | `vlnv.name` |
| `generic` declarations | `parameters` (name, type, default value) |
| Ports ending in `clk`, `clock`, `aclk` | `clocks` |
| Ports ending in `rst`, `reset`, `rst_n`, `aresetn` | `resets` (polarity auto-detected) |
| Remaining port declarations | `ports` (direction, width, logical name) |
| AXI-Lite or Avalon-MM port patterns | `busInterfaces` (type, mode, physical prefix) |

**Bus interface detection:** The parser looks for known signal name patterns:

- **AXI-Lite** — detected when 4+ ports match `<prefix>awaddr`, `<prefix>awvalid`, `<prefix>wdata`, etc.
- **Avalon-MM** — detected when 3+ ports match `<prefix>address`, `<prefix>read`, `<prefix>writedata`, etc.

The prefix (e.g., `s_axi_`) is set as `physicalPrefix`.

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

1. Run `IPCraft: Parse Altera Platform Designer Component (_hw.tcl) to .ip.yml`
2. Select the `_hw.tcl` file from the file picker

**Explorer context menu:**

Right-click a `_hw.tcl` file → **IPCraft: Parse Altera Platform Designer Component (_hw.tcl) to .ip.yml**

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

1. Run `IPCraft: Parse Xilinx component.xml to .ip.yml`
2. Select the `component.xml` file from the file picker

**Explorer context menu:**

Right-click `component.xml` → **IPCraft: Parse Xilinx component.xml to .ip.yml**

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
