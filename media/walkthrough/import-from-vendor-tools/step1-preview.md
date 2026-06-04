## Preview before you commit

Before converting a vendor file to `.ip.yml`, use **Preview in IPCraft** to see a read-only canvas rendered from the source. This lets you verify that IPCraft's parser understands the file correctly before creating any new files.

### Supported source formats

| File | Tool | Parser |
|------|------|--------|
| `*_hw.tcl` | Intel Quartus Platform Designer | Parses `add_interface`, `add_interface_port`, `add_parameter` |
| `component.xml` | Xilinx/AMD Vivado IP-XACT | Parses IP-XACT 2009 and 2014 schemas |
| `*.vhd` / `*.vhdl` | Any VHDL toolchain | Parses entity declarations |
| `*.sv` / `*.v` | Any SV/Verilog toolchain | Parses module declarations |

### How to open the preview

**Option 1:** Open the file in VS Code and press **Ctrl+Shift+V**

**Option 2:** Right-click the file in the Explorer → **Preview in IPCraft**

**Option 3:** Run **IPCraft: Preview in IPCraft** from the Command Palette with the file open

### What the preview shows

The preview renders the same canvas as a full `.ip.yml` editor, but in read-only mode. You can click ports and bus interfaces to see their detected properties in the Inspector panel.

If something looks wrong in the preview, check the source file before converting — it is easier to fix in the original than to correct the imported `.ip.yml` afterwards.
