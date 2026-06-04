## Preview a template before committing

Open any `.j2` file in the pack folder and click the
**$(open-preview) Preview Template Output** icon in the editor title bar
(or run the command from the palette).

A read-only panel opens beside the editor showing the rendered result:

```
top.vhdl.j2  (editor)       │  top.vhd  (preview)
─────────────────────────────┼──────────────────────────────
entity {{ entity_name }} is  │  entity spi_controller is
  port (                     │    port (
{% for p in bus_ports %}     │      s_axi_awvalid : in std_logic;
  ...                        │      s_axi_awready : out std_logic;
{% endfor %}                 │      ...
```

The preview uses a real IP core from your workspace as context so register
names, port names, bus types, and generics all resolve to real values.

**On first use** IPCraft scans for `.ip.yml` files in the workspace:

- One file found → used automatically.
- Several found → a quick-pick asks which one to use.
- Choose **Always use this file** to pin it for future previews.

**Save the template** (`Ctrl+S`) → the preview refreshes.
