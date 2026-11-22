# LED tutorial checkpoints

Each folder here holds the starting files of one episode of the LED tutorial:
the LED controller project as that episode begins. Open the folder of the
episode you want to follow and you have what it starts with, without doing the
earlier episodes first.

The last checkpoint matches the finished project in
[`examples/led_avmm/`](../../led_avmm/), except that it has no `fileSets`
(the example has them for its hand-written tests, which the series does not
cover).

| Episode | Folder | What is new in it |
|---|---|---|
| 2 | [`02-create-the-core/`](02-create-the-core/) | An empty folder. |
| 3 | [`03-add-the-registers/`](03-add-the-registers/) | The `.ip.yml` with clock, reset, `led[7:0]`, and an Avalon-MM slave. |
| 4 | [`04-generate-the-rtl/`](04-generate-the-rtl/) | A linked `.mm.yml` with `VERSION` and `LED_PATTERN`. |
| 5 | [`05-write-the-user-logic/`](05-write-the-user-logic/) | The scaffold pack and the Quartus target are set in the `.ip.yml`. |
| 6 | [`06-verify-in-simulation/`](06-verify-in-simulation/) | The user logic: `LED_PATTERN` drives the LEDs. |
| 7 | [`07-grow-the-design/`](07-grow-the-design/) | The same files as episode 6. Episode 6 changes no files. |
| 8 | [`08-into-a-system/`](08-into-a-system/) | The `EVENTS` register with its heartbeat, and the Platform Designer system scripts. |
| 9 | [`09-build-with-quartus/`](09-build-with-quartus/) | The DE10-Nano top level, Quartus project and Makefile, and the Nios II software. |
| 10 | [`10-on-the-board/`](10-on-the-board/) | The System Console debug scripts. |

## What a checkpoint holds

A checkpoint holds only what a person writes or is handed: the spec files
(`.ip.yml`, `.mm.yml`), hand-written code, and the provided board files.

It does not hold generator output (`rtl/` files other than the user-owned core,
`tb/`, `docs/`, and the vendor packaging in `altera/`). The files of the
example drift from the current generator over time, and copies in every
checkpoint would drift the same way. A `.gitignore` in this folder lists the
generator output, so generating in place leaves `git status` clean.

## How to use a checkpoint

1. Open the folder in VS Code. Keep checkpoints 09 and 10 inside
   `examples/tutorial/led/`: their Quartus project and Makefile use files from
   `examples/common/`.
2. From checkpoint 05 on, open the `.ip.yml` and run **IPCraft: Scaffold
   Project (RTL + EDA packaging + Testbench)**. Choose the `example-with-docs`
   scaffold pack, the VHDL language, and the Quartus target in the toolbar.
   IPCraft recreates the generated files.
3. When the staging review lists the user-owned core
   (`rtl/led_controller_avmm_core.vhd`), keep it.
4. Follow the episode.

The integration test `src/test/integration/tutorialCheckpoints.test.ts`
generates every checkpoint with the current generator and checks the result.
Run it with `npm run test:integration:tutorial`.
