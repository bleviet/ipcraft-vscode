# Makefile for the regmap_conformance_axil Quartus project.
# Board-in-the-loop automation for docs/hardware-conformance-test-plan.md,
# "Component 5", AXI4-Lite variant (Variant B).
#
# All steps run inside the ipcraft-examples/quartus:23.1 Docker container. Call any
# target directly from the WSL2 host -- Docker is invoked automatically.
#
# Unlike regmap_conformance_avmm (Avalon-MM, Nios II + JTAG debug master),
# this system is FPGA-fabric-only: a JTAG-to-Avalon-MM debug master
# connects directly to the AXI4-Lite conformance IP, and Platform Designer
# auto-inserts the Avalon<->AXI4 protocol bridge. No HPS, no Nios II, no
# BSP/app build steps.
#
# All vendor tooling lives under altera/ (this file's own directory tree) --
# rtl/ and tb/ one level up are vendor-neutral and shared with any future
# Xilinx/Vivado port of this example.

PROJECT_NAME  = regmap_conformance_axil
REVISION_NAME = de10_nano

QSYS_TCL      = ../qsys/regmap_conformance_axil_system.tcl
QSYS_FILE     = ../qsys/regmap_conformance_axil_system.qsys
QSYS_GEN_DIR  = ../qsys/regmap_conformance_axil_system_gen

DEBUG_DIR     = ../debug

DOCKER_IMAGE ?= ipcraft-examples/quartus:23.1

# usbipd-win bus ID for the USB-Blaster II.
USBIPD       ?= usbipd.exe
USBIPD_BUSID ?= 8-3

# JTAG chain device index: 1=HPS ARM DAP, 2=Cyclone V FPGA
DEVICE_INDEX ?= 2

# REPO_ROOT is the examples/ directory (three levels up: quartus -> altera ->
# <example> -> examples), not the whole ipcraft-vscode repo -- this is the
# smallest root that covers both this example and the shared examples/common/
# resources (e.g. power_on_reset_generator.vhd).
REPO_ROOT  = $(realpath ../../..)
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

.PHONY: all qsys project compile clean sim \
        program-sof usb-windows usb-wsl \
        quartus-gui platform-designer \
        conformance-sysconsole test

all: qsys project compile

# ── Step 0: pre-hardware gate -- the cocotb scoreboard on GHDL ───────────────
sim:
	$(MAKE) -C ../../tb SIM=ghdl WAVES=0

# ── Step 1: generate the .qsys file from the TCL script ──────────────────────
$(QSYS_FILE): $(QSYS_TCL)
	$(DOCKER) "$(DOCKER_CWD) && cd ../qsys && qsys-script --script=regmap_conformance_axil_system.tcl --search-path=/work/$(PROJECT_NAME)/altera/qsys,\$$"

qsys: $(QSYS_FILE)
	$(DOCKER) "$(DOCKER_CWD) && qsys-generate $(QSYS_FILE) --synthesis=VHDL --output-directory=$(QSYS_GEN_DIR) \
	  --search-path=/work/$(PROJECT_NAME)/altera/qsys,\$$"

# ── Step 2: create and compile the Quartus project ───────────────────────────
project: $(QSYS_GEN_DIR)/synthesis/regmap_conformance_axil_system.qip
	$(DOCKER) "$(DOCKER_CWD) && quartus_sh -t de10_nano_project.tcl"

compile:
	$(DOCKER) "$(DOCKER_CWD) && quartus_sh --flow compile $(PROJECT_NAME) -c $(REVISION_NAME)"

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

# ── GUI targets ───────────────────────────────────────────────────────────────
quartus-gui:
	$(DOCKER_GUI) "$(DOCKER_CWD) && quartus $(PROJECT_NAME).qpf 2>/dev/null || quartus"

platform-designer:
	$(DOCKER_GUI) "$(DOCKER_CWD) && qsys-edit $(QSYS_FILE) 2>/dev/null || qsys-edit"

# ── Conformance self-test runner (Component 5: board-in-the-loop) ────────────

# conformance-sysconsole: Run the System Console Tcl host -- no firmware
# needed, register access only over the JTAG-to-Avalon-MM master (bridged
# to AXI4-Lite by Platform Designer).
conformance-sysconsole: usb-wsl
	docker run --rm --user $$(id -u):$$(id -g) --privileged \
	  -v /dev/bus/usb:/dev/bus/usb \
	  -v $(REPO_ROOT):/work \
	  -v /tmp:/tmp \
	  $(DOCKER_IMAGE) \
	  bash -c 'jtagd && sleep 5 && \
	    printf "source /work/$(PROJECT_NAME)/altera/debug/conformance_sysconsole.tcl\n" | system-console --cli > /tmp/conformance_axil_sysconsole_output.txt 2>&1; \
	    cat /tmp/conformance_axil_sysconsole_output.txt; \
	    kill $$(pgrep jtagd) 2>/dev/null || true; \
	    grep -q "@@RESULT CONFORMANCE: ALL PASS" /tmp/conformance_axil_sysconsole_output.txt'

# test: Aggregate exit code. program-sof is a hard prerequisite -- several
# checks assert post-reset state and the host writes non-reset values as
# part of its own sequence, so a stale board from a prior run is not
# idempotent. Always reprogram before grading.
test: sim program-sof conformance-sysconsole
	@echo "==== regmap_conformance_axil: all hosts PASS ===="

# ── Clean ─────────────────────────────────────────────────────────────────────
clean:
	$(DOCKER) "$(DOCKER_CWD) && \
	  rm -rf db incremental_db output_files && \
	  rm -rf $(QSYS_GEN_DIR) $(QSYS_FILE) && \
	  find . -maxdepth 1 \( -name '*.rpt' -o -name '*.summary' -o -name '*.qsf' \
	    -o -name '*.qpf' -o -name '*.qws' -o -name '*.done' -o -name '*.smsg' \
	    -o -name '*.jdi' -o -name '*.pin' -o -name '*.sld' -o -name '*.sof' \
	    -o -name 'dump.txt' \) -delete"
