# Importing from VHDL

How to convert an existing VHDL entity into an IPCraft specification file.

## Prerequisites

- IPCraft extension installed and active in VS Code
- A `.vhd` or `.vhdl` file containing a VHDL entity declaration

## Methods

There are three ways to trigger the import:

### Command Palette

1. Open the command palette (`Ctrl+Shift+P`)
2. Type `IPCraft: Import from VHDL`
3. Select the VHDL file from the file picker

### Context Menu

1. Right-click a `.vhd` or `.vhdl` file in the Explorer sidebar
2. Click **Import from VHDL**

### Editor Title Bar

1. Open a `.vhd` or `.vhdl` file in the text editor
2. Click the **Import from VHDL** icon in the editor title bar

## What Gets Imported

The parser extracts the following from your VHDL entity:

| VHDL Construct | IPCraft Field |
|----------------|---------------|
| Entity name | `vlnv.name` |
| `generic` declarations | `parameters` (with name, type, default value) |
| `port` signals ending in `clk`, `clock`, `aclk` | `clocks` |
| `port` signals ending in `rst`, `reset`, `rst_n`, `aresetn` | `resets` (polarity auto-detected) |
| Remaining `port` declarations | `ports` (with direction, width, logical name) |
| AXI-Lite or Avalon-MM signal patterns | `busInterfaces` (with type, mode, physical prefix) |

### Bus Interface Detection

The parser looks for known signal name patterns to detect bus interfaces:

- **AXI-Lite**: detected when 4+ ports match the pattern `<prefix>awaddr`, `<prefix>awvalid`, `<prefix>wdata`, etc.
- **Avalon-MM**: detected when 3+ ports match `<prefix>address`, `<prefix>read`, `<prefix>writedata`, etc.

The prefix (e.g., `s_axi_`) is extracted and set as `physicalPrefix`.

### Port Width Handling

- `std_logic` signals are imported with width 1
- `std_logic_vector(N downto 0)` signals are imported with numeric width `N+1`
- `std_logic_vector(PARAM-1 downto 0)` signals are imported with parameterized width referencing the generic name

## Output

The importer creates a `<entity_name>.ip.yml` file in the same directory as the source VHDL file. The file includes:

- `apiVersion: ipcore/v1.0`
- VLNV with the entity name
- All detected clocks, resets, ports, bus interfaces, and parameters
- A `fileSets` entry referencing the original VHDL file

After import, click **Open File** in the notification to open the generated spec in the IP Core visual editor.

## Post-Import Steps

1. Open the generated `.ip.yml` in the IP Core editor
2. Review and refine the VLNV metadata (vendor, library, version)
3. Add `memoryMapRef` to any bus interfaces that should have register maps
4. Create a corresponding `.mm.yml` file if your IP has registers
5. Fill in descriptions for clocks, resets, and ports
