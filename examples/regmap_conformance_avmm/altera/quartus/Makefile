# Makefile for the regmap_conformance_avmm Quartus project.
# Board-in-the-loop automation for docs/hardware-conformance-test-plan.md.
# Orchestrates: Platform Designer generation -> Quartus compile -> BSP
# generation -> app build -> program -> run the conformance self-test ->
# aggregate PASS/FAIL exit code.
#
# All steps run inside the cvsoc/quartus:23.1 Docker container. Call any
# target directly from the WSL2 host -- Docker is invoked automatically.
#
# All vendor tooling lives under altera/ (this file's own directory tree) --
# rtl/ and tb/ two levels up are vendor-neutral and shared with any future
# Xilinx/Vivado port of this example. software/ one level up is also
# vendor-neutral at the top (app/): only software/platform/nios2/ is
# Altera/Nios II-specific.
#
# Nios II and the JTAG-to-Avalon-MM debug master are combined in ONE qsys
# system (../qsys/regmap_conformance_system.tcl) -- there is no separate
# "debug" variant to build.

PROJECT_NAME  = regmap_conformance_avmm
REVISION_NAME = de10_nano

QSYS_TCL      = ../qsys/regmap_conformance_system.tcl
QSYS_FILE     = ../qsys/regmap_conformance_system.qsys
QSYS_GEN_DIR  = ../qsys/regmap_conformance_system_gen
SOPCINFO      = ../qsys/regmap_conformance_system.sopcinfo

REGMAP_BASE   = 0x00010000
DEBUG_DIR     = ../debug

BSP_DIR       = ../../software/platform/nios2/bsp
APP_DIR       = ../../software/platform/nios2

DOCKER_IMAGE ?= cvsoc/quartus:23.1

# usbipd-win bus ID for the USB-Blaster II.
# Find yours with: usbipd.exe list  (look for "USB-Blaster")
# Override with: make USBIPD_BUSID=<id> program-sof
USBIPD       ?= usbipd.exe
USBIPD_BUSID ?= 8-3

# JTAG chain device index: 1=HPS ARM DAP, 2=Cyclone V FPGA
DEVICE_INDEX ?= 2

# REPO_ROOT is the examples/ directory (three levels up: quartus -> altera ->
# <example> -> examples), not the whole ipcraft-vscode repo -- this is the
# smallest root that covers this example plus the shared examples/common/
# resources (power_on_reset_generator.vhd, uname_shim.sh).
REPO_ROOT  = $(realpath ../../..)
UNAME_SHIM = $(REPO_ROOT)/common/docker/uname_shim.sh
DOCKER     = docker run --rm --user $$(id -u):$$(id -g) -v $(REPO_ROOT):/work $(DOCKER_IMAGE) bash -c
DOCKER_CWD = cd /work/$(PROJECT_NAME)/altera/quartus
DOCKER_GUI = docker run --rm --user $$(id -u):$$(id -g) \
  -e DISPLAY=$$DISPLAY \
  -v /tmp/.X11-unix:/tmp/.X11-unix \
  -v /mnt/wslg:/mnt/wslg \
  -e WAYLAND_DISPLAY=$$WAYLAND_DISPLAY \
  -e XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir \
  -v $(REPO_ROOT):/work \
  $(DOCKER_IMAGE) bash -c

.PHONY: all qsys project compile bsp app clean sim \
        program-sof download-elf terminal usb-windows usb-wsl \
        quartus-gui platform-designer \
        conformance-sysconsole conformance-nios test

all: qsys project compile bsp app

# ── Step 0: pre-hardware gate -- the cocotb scoreboard on GHDL ───────────────
# Must be green before any board step (docs/hardware-conformance-test-plan.md
# Verification step 2).
sim:
	$(MAKE) -C ../../tb SIM=ghdl WAVES=0

# ── Step 1: generate the .qsys file from the TCL script ──────────────────────
$(QSYS_FILE): $(QSYS_TCL)
	$(DOCKER) "$(DOCKER_CWD) && cd ../qsys && qsys-script --script=regmap_conformance_system.tcl --search-path=/work/$(PROJECT_NAME)/altera/qsys,\$$"

qsys: $(QSYS_FILE)
	$(DOCKER) "$(DOCKER_CWD) && qsys-generate $(QSYS_FILE) --synthesis=VHDL --output-directory=$(QSYS_GEN_DIR) \
	  --search-path=/work/$(PROJECT_NAME)/altera/qsys,\$$"

# ── Step 2: create and compile the Quartus project ───────────────────────────
project: $(QSYS_GEN_DIR)/synthesis/regmap_conformance_system.qip
	$(DOCKER) "$(DOCKER_CWD) && quartus_sh -t de10_nano_project.tcl"

compile:
	$(DOCKER) "$(DOCKER_CWD) && quartus_sh --flow compile $(PROJECT_NAME) -c $(REVISION_NAME)"

# ── Step 3: generate the Nios II HAL BSP ─────────────────────────────────────
BSP_DEFAULT_TCL = /opt/intelFPGA/nios2eds/sdk2/bin/bsp-set-defaults.tcl

bsp: $(SOPCINFO)
	$(DOCKER) "$(DOCKER_CWD) && \
	  mkdir -p $(BSP_DIR) && \
	  nios2-bsp-create-settings \
	    --sopc $(SOPCINFO) \
	    --type hal \
	    --settings $(BSP_DIR)/settings.bsp \
	    --bsp-dir $(BSP_DIR) \
	    --script $(BSP_DEFAULT_TCL) \
	    --cpu-name nios2 && \
	  make -C $(BSP_DIR) WINDOWS_EXE="

# ── Step 4: build the C application ──────────────────────────────────────────
app: bsp
	$(DOCKER) "$(DOCKER_CWD) && make -C $(APP_DIR)"

# ── Programming & debug targets ──────────────────────────────────────────────
usb-wsl:
	@echo "Connecting USB-Blaster (busid $(USBIPD_BUSID)) to WSL2..."
	$(USBIPD) attach --wsl --busid $(USBIPD_BUSID) 2>/dev/null || true
	@sleep 1

usb-windows:
	@echo "Detaching USB-Blaster (busid $(USBIPD_BUSID)) from WSL2 -> Windows..."
	$(USBIPD) detach --busid $(USBIPD_BUSID) 2>/dev/null || true
	@sleep 1

# program-sof: Programs the FPGA bitstream via JTAG entirely from WSL2.
program-sof: usb-wsl $(REVISION_NAME).sof
	docker run --rm --user $$(id -u):$$(id -g) --privileged \
	  -v /dev/bus/usb:/dev/bus/usb \
	  -v $(REPO_ROOT):/work \
	  $(DOCKER_IMAGE) \
	  bash -c 'jtagd && sleep 2 && \
	    quartus_pgm -m jtag -o "p;/work/$(PROJECT_NAME)/altera/quartus/$(REVISION_NAME).sof@$(DEVICE_INDEX)"; \
	    kill $$(pgrep jtagd) 2>/dev/null || true'

# download-elf: Downloads the Nios II ELF to the soft-core via JTAG and starts it.
download-elf: usb-wsl $(APP_DIR)/regmap_conformance_test.elf
	docker run --rm --user $$(id -u):$$(id -g) --privileged \
	  -v $(REPO_ROOT):/work \
	  -v $(UNAME_SHIM):/usr/local/bin/uname:ro \
	  $(DOCKER_IMAGE) \
	  nios2-download -g /work/$(PROJECT_NAME)/software/platform/nios2/regmap_conformance_test.elf

# terminal: Opens the Nios II JTAG UART terminal (Ctrl-C to quit).
terminal: usb-wsl
	docker run --rm --user $$(id -u):$$(id -g) -it --privileged \
	  -v $(UNAME_SHIM):/usr/local/bin/uname:ro \
	  $(DOCKER_IMAGE) \
	  nios2-terminal

# ── GUI targets ───────────────────────────────────────────────────────────────
quartus-gui:
	$(DOCKER_GUI) "$(DOCKER_CWD) && quartus $(PROJECT_NAME).qpf 2>/dev/null || quartus"

platform-designer:
	$(DOCKER_GUI) "$(DOCKER_CWD) && qsys-edit $(QSYS_FILE) 2>/dev/null || qsys-edit"

# ── Conformance self-test runners (Component 5: board-in-the-loop) ───────────

# conformance-nios: Download the ELF, run the JTAG UART self-test, capture
# output, grep for the ALL PASS sentinel. Returns nonzero on any FAIL or if
# the sentinel never appears (hang / crash).
#
# KNOWN LIMITATION (docs/hardware_validation_results.md): live JTAG UART
# text capture has not been made reliable here -- this target currently
# fails even though the firmware demonstrably executes correctly (confirmed
# via SCRATCH register readback after a run). Not included in `test`'s hard
# gate; kept as a manual/best-effort target pending a fix (candidates: the
# System Console `processor`/`bytestream` services, or a register-polling
# host that reads a result-summary register instead of parsing UART text).
conformance-nios: usb-wsl $(APP_DIR)/regmap_conformance_test.elf
	docker run --rm --user $$(id -u):$$(id -g) --privileged \
	  -v $(REPO_ROOT):/work \
	  -v $(UNAME_SHIM):/usr/local/bin/uname:ro \
	  -v /tmp:/tmp \
	  $(DOCKER_IMAGE) \
	  bash -c '\
	    nios2-download -g /work/$(PROJECT_NAME)/software/platform/nios2/regmap_conformance_test.elf && \
	    timeout 20 nios2-terminal > /tmp/conformance_nios_output.txt 2>&1; \
	    cat /tmp/conformance_nios_output.txt; \
	    grep -q "CONFORMANCE: ALL PASS" /tmp/conformance_nios_output.txt'

# conformance-sysconsole: Run the System Console Tcl host -- no Nios II
# firmware needed, register access only over the JTAG-to-Avalon-MM master.
# System Console's --cli REPL doesn't support `exit`, so the Tcl script only
# prints a @@RESULT sentinel; this target greps stdout for it and propagates
# a nonzero exit code on FAIL (or if the sentinel never appears).
conformance-sysconsole: usb-wsl
	docker run --rm --user $$(id -u):$$(id -g) --privileged \
	  -v /dev/bus/usb:/dev/bus/usb \
	  -v $(REPO_ROOT):/work \
	  -v /tmp:/tmp \
	  $(DOCKER_IMAGE) \
	  bash -c 'jtagd && sleep 5 && \
	    printf "source /work/$(PROJECT_NAME)/altera/debug/conformance_sysconsole.tcl\n" | system-console --cli > /tmp/conformance_sysconsole_output.txt 2>&1; \
	    cat /tmp/conformance_sysconsole_output.txt; \
	    kill $$(pgrep jtagd) 2>/dev/null || true; \
	    grep -q "@@RESULT CONFORMANCE: ALL PASS" /tmp/conformance_sysconsole_output.txt'

# test: Aggregate exit code. The firmware/host PASS is the single source of
# truth; this target just greps the sentinel and propagates a nonzero exit
# if any host reports a FAIL (docs/hardware-conformance-test-plan.md
# Verification step 3/4).
#
# program-sof is a hard prerequisite, not just "build once": several checks
# (e.g. control_nonzero_reset) assert post-reset state, and the host writes
# non-reset values as part of its own sequence -- a stale board from a prior
# run is not idempotent. Always reprogram before grading.
#
# conformance-nios is intentionally NOT in this gate (see its target
# comment for why); conformance-sysconsole is the CI-gateable source of
# truth today.
test: sim program-sof conformance-sysconsole
	@echo "==== regmap_conformance_avmm: all hosts PASS ===="

# ── Clean ─────────────────────────────────────────────────────────────────────
clean:
	$(DOCKER) "$(DOCKER_CWD) && \
	  rm -rf db incremental_db output_files && \
	  rm -rf $(QSYS_GEN_DIR) $(QSYS_FILE) && \
	  rm -rf $(BSP_DIR) && \
	  make -C $(APP_DIR) clean 2>/dev/null || true && \
	  find . -maxdepth 1 \( -name '*.rpt' -o -name '*.summary' -o -name '*.qsf' \
	    -o -name '*.qpf' -o -name '*.qws' -o -name '*.done' -o -name '*.smsg' \
	    -o -name '*.jdi' -o -name '*.pin' -o -name '*.sld' -o -name '*.sof' \
	    -o -name 'dump.txt' \) -delete"
