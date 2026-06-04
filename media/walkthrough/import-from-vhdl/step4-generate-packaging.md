## Packaging for Vivado and Quartus

Once your `.ip.yml` is correct, generating vendor packaging files is one command each.

### Vivado — component.xml (IP-XACT)

**Export Xilinx component.xml** generates an IP-XACT descriptor that Vivado's IP Catalog can consume directly. The file includes:

- VLNV identification
- Port declarations with direction and width
- Bus interface definitions with port maps
- Clock and reset associations
- Parameter declarations with types and ranges
- File sets pointing at your RTL sources

After generating, add the IP to the Vivado IP Catalog by pointing it at the directory containing `component.xml`.

### Quartus — _hw.tcl (Platform Designer)

**Export Platform Designer _hw.tcl** generates a Quartus Platform Designer component file that matches your `.ip.yml` spec.

The TCL file includes:
- `set_module_property` statements for name, version, and display name
- `add_interface` and `add_interface_port` for every bus and port
- File set declarations with your RTL paths

### Generating both simultaneously

Run **Scaffold Full Project** with both `vivado` and `quartus` listed in your targets. IPCraft generates both descriptors alongside the RTL in a single staging run.

```yaml
# In .ip.yml
targets: [vivado, quartus]
```

> **Tip:** You can open the generated `component.xml` in Vivado IP Packager directly with **Edit in Vivado IP Packager** for final tweaks — any changes you make there will be preserved on subsequent scaffolds.
