# Rendering Documentation Images

Keep the diagrams in your documentation current by describing them once in a
manifest and regenerating them with one command. The images are drawn from the
same files the VS Code editors read, so they change only when a design does.

## Write the manifest

Create `docs/images.yml` next to the documentation. Paths are relative to this
file.

```yaml
defaults: { theme: light, scale: 2 }
images:
  - source: ../ip/axi_dma.ip.yml
    out: img/axi_dma.svg
  - source: ../bd/system.tcl
    out: img/system.png
    workspace: ../ip
  - source: ../bd/system.tcl
    out: img/dma-context.png
    select: [axi_dma_0]
    hops: 2
    workspace: ../ip
  - source: ../bd/system.tcl
    out: img/clocks.svg
    clocks: true
```

`workspace` points at the folder holding the `.ip.yml` and HDL files that define
the blocks, so the image shows their pins as the system viewer does. Without it
the design's own folder is searched.

## Render

```bash
ipcraft render --manifest docs/images.yml
```

Each image prints a `Rendered` line. If an entry has a mistake, it is reported
with its position in the list (`images[1] (../bd/system.tcl): ...`), the other
images are still written, and the command exits with 1, so a documentation build
can fail on it.

Commit the images with the manifest. Running the command again gives the same
bytes, so `git diff` shows only the diagrams whose design changed.

## Export from the editors

The system viewer and the IP core editor have an **Export image** button and the
command **IPCraft: Export Diagram as Image**. They draw through the same renderer
as `ipcraft render`, so an exported image with the **Whole level** (or **Whole
diagram**) area equals what the command writes for the same design and options.
Use the editors for one-off images, including **Current view** crops, and the
command for images that must stay current in a documentation build. See
[Viewing a system design](view-a-system-design.md#export-an-image).

See [the generator reference](../reference/generator.md#rendering-a-system-design-or-an-ip-core-as-an-image)
for every option.
