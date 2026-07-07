# Icon concept — variant F (Fable 5)

**Concept: Connected Core.** The mark is the IP block exactly as IPCraft's
canvas treats it: a chip-bodied block with capsule ports on three edges, while
on the fourth edge one interface is routed outward to an open terminal ring —
the moment of wiring up a bus. The many-in, one-out asymmetry gives the icon a
distinct silhouette (block plus wired node) that no generic chip icon has, and
it tells the product's first pillar directly. The second pillar stays as
secondary texture: two register rows die-cut into the body, the lower one split
into unequal bitfields — a quiet inheritance from the old icon.

Every interior detail is negative space cut clean through the mark, so the icon
is theme-agnostic by construction: the cuts render dark on VS Code's dark
sidebar and light on white Marketplace cards, with the saturated gradient
carrying contrast in both.

It survives small sizes because there are zero strokes — everything is filled
geometry, so downscaling cannot thin it. The smallest features (9px pins, 10px
register slits, 5px ring wall on the 128 grid) stay above 2 physical pixels at
32px; verified with rasters at 40, 32, and 24px.

**Color:** the brand gradient `#FF512F -> #DD2476` is kept unchanged — it
preserves recognition for existing users, and warm coral-to-magenta stands out
in a category dominated by blue and teal chips.
