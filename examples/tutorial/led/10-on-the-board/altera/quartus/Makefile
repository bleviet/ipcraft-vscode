# Makefile for the led_avmm Quartus project (Nios V, Quartus Prime 24.x or newer).
# Orchestrates: Platform Designer generation -> Quartus compile -> BSP
# generation -> app build, and the board targets (program, download, debug).
#
# The tools come from a local Quartus Prime install when quartus_sh is on the
# PATH (or QUARTUS_ROOTDIR is set), otherwise from the Docker image
# $(DOCKER_IMAGE) that you build or tag yourself. Force one with USE_DOCKER=0
# or USE_DOCKER=1.
#
# led_controller_avmm's RTL/altera/tb are IPCraft-generated
# (../../led_controller_avmm.ip.yml, .mm.yml); this Makefile only builds the
# board-level project around it.
#
# All vendor tooling lives under altera/ (this file's own directory tree) --
# rtl/ and tb/ two levels up are vendor-neutral and shared with any future
# Xilinx/Vivado port of this example. software/ one level up is also
# vendor-neutral at the top (app/): only software/platform/niosv/ is
# Altera/Nios V-specific.
#
# Software needs the Nios V RISC-V GNU toolchain (riscv32-unknown-elf-gcc on
# the PATH) in addition to Quartus; see `make check-compiler`.

PROJECT_NAME  = led_avmm
REVISION_NAME = de10_nano

QSYS_TCL      = ../qsys/led_avmm_system.tcl
QSYS_FILE     = ../qsys/led_avmm_system.qsys
QSYS_GEN_DIR  = ../qsys/led_avmm_system_gen
SOPCINFO      = ../qsys/led_avmm_system.sopcinfo
# led_controller_avmm_hw.tcl, which IPCraft writes here, is found through the
# Platform Designer search path (--search-path), not through a copy or a link.
ALTERA_DIR    = ..

# Debug variant: uses led_avmm_system_debug.tcl which adds a JTAG-to-Avalon-MM
# master for System Console register access.
DEBUG_DIR      = ../debug
LED_CTRL_BASE  = 0x00010010

BSP_DIR       = ../../software/platform/niosv/bsp
APP_SRC_DIR   = ../../software/platform/niosv
APP_BUILD_DIR = $(APP_SRC_DIR)/build
APP_ELF       = $(APP_BUILD_DIR)/led_avmm_demo.elf
SOF          ?= $(REVISION_NAME).sof

# JTAG chain device index: 1=HPS ARM DAP, 2=Cyclone V FPGA
DEVICE_INDEX ?= 2

# Options for niosv-download: -g starts the program after the download. If the
# Ashling RiscFree tools (ash-riscv-gdb-server) are not installed, use
#   make DOWNLOAD_FLAGS="-o -g" download-elf
# to go through OpenOCD and riscv32-unknown-elf-gdb instead.
DOWNLOAD_FLAGS ?= -g

# usbipd-win bus ID of the USB-Blaster II when Quartus runs in WSL2 (the
# usb-wsl target attaches it). It is specific to your machine and has no
# default: find yours with `usbipd.exe list` (look for "USB-Blaster"), then
#   make USBIPD_BUSID=<id> program-sof
# Leave it unset when the cable is already visible to the tools.
USBIPD       ?= usbipd.exe
USBIPD_BUSID ?=

# REPO_ROOT is the examples/ directory (five levels up: quartus -> altera ->
# <checkpoint> -> led -> tutorial -> examples), not the whole ipcraft-vscode
# repo -- this is the smallest root that covers this example plus the shared
# examples/common/ resources (power_on_reset_generator.vhd).
REPO_ROOT   = $(realpath ../../../../..)
# EXAMPLE_DIR is this project's path below REPO_ROOT, as seen inside Docker
# under /work (PROJECT_NAME stays the Quartus project name).
EXAMPLE_DIR = $(patsubst $(REPO_ROOT)/%,%,$(realpath ../..))

DOCKER_IMAGE ?= ipcraft-examples/quartus:25.1
NATIVE_QUARTUS_BIN := $(shell command -v quartus_sh 2>/dev/null)
USE_DOCKER ?= $(if $(or $(QUARTUS_ROOTDIR),$(NATIVE_QUARTUS_BIN)),0,1)

ifeq ($(USE_DOCKER),1)
# TOOL_RUN runs a quoted shell command with the Quartus tools on the PATH.
# JTAG_RUN is the same for commands that talk to the USB-Blaster: the
# container needs the USB bus, and starts its own jtagd (JTAG_UP/JTAG_DOWN).
DOCKER_RUN = docker run --rm --user $$(id -u):$$(id -g) -v $(REPO_ROOT):/work -v /tmp:/tmp
TOOL_RUN   = $(DOCKER_RUN) $(DOCKER_IMAGE) bash -c
JTAG_RUN   = $(DOCKER_RUN) --privileged -v /dev/bus/usb:/dev/bus/usb $(DOCKER_IMAGE) bash -c
JTAG_UP    = jtagd && sleep 5 &&
JTAG_DOWN  = ; kill $$(pgrep -x jtagd) 2>/dev/null || true
TOOL_CWD   = cd /work/$(EXAMPLE_DIR)/altera/quartus
TOOL_ALTERA_DIR = /work/$(EXAMPLE_DIR)/altera
TOOL_APP_SRC_DIR = /work/$(EXAMPLE_DIR)/software/platform/niosv
TOOLCHAIN_CHECK = command -v docker >/dev/null 2>&1
else
NATIVE_QUARTUS_ROOT := $(if $(QUARTUS_ROOTDIR),$(QUARTUS_ROOTDIR),$(if $(NATIVE_QUARTUS_BIN),$(realpath $(dir $(NATIVE_QUARTUS_BIN))/..)))
ifeq ($(NATIVE_QUARTUS_ROOT),)
$(error Quartus not found. Put quartus_sh on the PATH, set QUARTUS_ROOTDIR, or use USE_DOCKER=1)
endif
NATIVE_ALTERA_ROOT := $(realpath $(NATIVE_QUARTUS_ROOT)/..)
NATIVE_ENV = env QUARTUS_ROOTDIR="$(NATIVE_QUARTUS_ROOT)" \
  QSYS_ROOTDIR="$(NATIVE_QUARTUS_ROOT)/sopc_builder/bin" \
  PATH="$(NATIVE_QUARTUS_ROOT)/bin:$(NATIVE_QUARTUS_ROOT)/sopc_builder/bin:$(NATIVE_ALTERA_ROOT)/niosv/bin:$$PATH"
TOOL_RUN   = $(NATIVE_ENV) bash -c
JTAG_RUN   = $(TOOL_RUN)
JTAG_UP    =
JTAG_DOWN  =
TOOL_CWD   = cd $(CURDIR)
TOOL_ALTERA_DIR = $(realpath $(ALTERA_DIR))
TOOL_APP_SRC_DIR = $(realpath $(APP_SRC_DIR))
NIOSV_COMPONENT = $(NATIVE_ALTERA_ROOT)/ip/altera/soft_processor/intel_niosv_m/intel_niosv_m_hw.tcl
TOOLCHAIN_CHECK = test -f "$(NIOSV_COMPONENT)" || { \
  echo "Quartus at $(NATIVE_ALTERA_ROOT) does not include intel_niosv_m." >&2; exit 1; }
endif

QSYS_SEARCH = --search-path=$(TOOL_ALTERA_DIR),\$$

.PHONY: all hardware software check-toolchain check-compiler qsys project compile \
        bsp app sim clean program-sof download-elf terminal usb-windows usb-wsl \
        quartus-gui platform-designer \
        debug-qsys debug-build debug-program debug-read-all debug-write-led \
        debug-dump debug-poll help

# The compiler is a separate Nios V prerequisite, so the default remains a
# complete FPGA hardware build. Use `make software` after installing it.
all: hardware
hardware: qsys project compile
software: bsp app

check-toolchain:
	@$(TOOLCHAIN_CHECK)

check-compiler:
	@$(TOOL_RUN) "command -v riscv32-unknown-elf-gcc >/dev/null 2>&1 || { \
	  echo 'Missing riscv32-unknown-elf-gcc required by the Nios V BSP.' >&2; \
	  echo 'Install the Nios V RISC-V GNU toolchain, then retry make software.' >&2; exit 1; }"

# ── Step 0: cocotb gate on GHDL ───────────────────────────────────────────────
sim:
	$(MAKE) -C ../../tb SIM=ghdl WAVES=0

# ── Step 1: generate the .qsys file from the TCL script ──────────────────────
# The generated altera/led_controller_avmm_hw.tcl defines the led_ctrl
# component; qsys-script finds it through the search path.
$(QSYS_FILE): $(QSYS_TCL) | check-toolchain
	$(TOOL_RUN) "$(TOOL_CWD) && cd ../qsys && qsys-script --script=led_avmm_system.tcl $(QSYS_SEARCH)"

qsys: $(QSYS_FILE)
	$(TOOL_RUN) "$(TOOL_CWD) && qsys-generate $(QSYS_FILE) --synthesis=VHDL --output-directory=$(QSYS_GEN_DIR) $(QSYS_SEARCH)"

$(QSYS_GEN_DIR)/synthesis/led_avmm_system.qip: qsys

$(SOPCINFO): qsys

# ── Step 2: create and compile the Quartus project ───────────────────────────
project: $(QSYS_GEN_DIR)/synthesis/led_avmm_system.qip
	$(TOOL_RUN) "$(TOOL_CWD) && quartus_sh -t de10_nano_project.tcl"

compile: project
	$(TOOL_RUN) "$(TOOL_CWD) && quartus_sh --flow compile $(PROJECT_NAME) -c $(REVISION_NAME)"

# ── Step 3: generate the Nios V HAL BSP ──────────────────────────────────────
bsp: $(SOPCINFO)
	$(TOOL_RUN) "$(TOOL_CWD) && rm -rf $(BSP_DIR) && \
	  niosv-bsp $(BSP_DIR)/settings.bsp --create --sopcinfo=$(SOPCINFO) --type=hal \
	    --bsp-dir=$(BSP_DIR) --cpu-instance=niosv"

# ── Step 4: build the C application ──────────────────────────────────────────
# niosv-app writes a CMakeLists.txt for main.c + platform.c + the portable
# ../../software/app/led_demo.c; cmake builds it against the BSP toolchain file.
app: bsp | check-compiler
	$(TOOL_RUN) "$(TOOL_CWD) && rm -rf $(APP_BUILD_DIR) && mkdir -p $(APP_BUILD_DIR) && \
	  niosv-app --app-dir=$(APP_BUILD_DIR) --bsp-dir=$(BSP_DIR) \
	    --srcs=$(APP_SRC_DIR)/main.c,$(APP_SRC_DIR)/platform.c,../../software/app/led_demo.c \
	    --incs=../../software/app --elf-name=led_avmm_demo.elf && \
	  cmake -S $(APP_BUILD_DIR) -B $(APP_BUILD_DIR) -DCMAKE_TOOLCHAIN_FILE=$(TOOL_APP_SRC_DIR)/bsp/toolchain.cmake && \
	  cmake --build $(APP_BUILD_DIR)"

# ── Programming & download targets ───────────────────────────────────────────
# usb-wsl: Attaches the USB-Blaster to WSL2 (usbipd-win); set USBIPD_BUSID.
usb-wsl:
	@if [ -n "$(USBIPD_BUSID)" ]; then \
	  echo "Connecting USB-Blaster (busid $(USBIPD_BUSID)) to WSL2..."; \
	  $(USBIPD) attach --wsl --busid $(USBIPD_BUSID) 2>/dev/null || true; \
	  sleep 1; \
	fi

# usb-windows: Returns the USB-Blaster to Windows (Windows fallback workflow only).
usb-windows:
	@test -n "$(USBIPD_BUSID)" || { echo "Set USBIPD_BUSID=<id> (usbipd.exe list)." >&2; exit 1; }
	@echo "Detaching USB-Blaster (busid $(USBIPD_BUSID)) from WSL2 -> Windows..."
	$(USBIPD) detach --busid $(USBIPD_BUSID) 2>/dev/null || true
	@sleep 1

# program-sof: Programs the FPGA bitstream ($(SOF), the last compile) via JTAG
# into the volatile configuration; flash and HPS are not touched.
program-sof: usb-wsl
	$(JTAG_RUN) "$(TOOL_CWD) && $(JTAG_UP) quartus_pgm -m jtag -o \"p;$(SOF)@$(DEVICE_INDEX)\" $(JTAG_DOWN)"

# download-elf: Downloads the Nios V ELF to the soft-core via JTAG and starts it.
#   niosv-download needs the native tools (niosv-shell), not Docker.
$(APP_ELF): app

download-elf: usb-wsl $(APP_ELF)
	@if [ "$(USE_DOCKER)" = "1" ]; then \
	  echo "Nios V hardware download must run natively, not inside Docker." >&2; exit 1; \
	fi
	$(TOOL_RUN) "$(TOOL_CWD) && niosv-shell --wait --run 'niosv-download $(DOWNLOAD_FLAGS) $(APP_ELF)'"

# terminal: Opens the JTAG UART terminal (Ctrl-C to quit). Native tools only.
#   Start it before download-elf to catch the first lines the app prints.
terminal: usb-wsl
	@if [ "$(USE_DOCKER)" = "1" ]; then \
	  echo "The JTAG UART terminal must run natively, not inside Docker." >&2; exit 1; \
	fi
	$(TOOL_RUN) "juart-terminal"

# ── GUI targets ───────────────────────────────────────────────────────────────
quartus-gui:
	$(TOOL_RUN) "$(TOOL_CWD) && quartus $(PROJECT_NAME).qpf 2>/dev/null || quartus"

platform-designer:
	$(TOOL_RUN) "$(TOOL_CWD) && qsys-edit $(QSYS_FILE) --search-path=$(TOOL_ALTERA_DIR),\$$ 2>/dev/null || qsys-edit"

# ── Debug variant: JTAG-to-Avalon-MM master + System Console targets ──────────
# These targets build and exercise a debug variant of the board design that
# includes an altera_jtag_avalon_master connected to led_ctrl.S_AVMM, enabling
# register peek/poke via System Console, with or without Nios V firmware.
#
# Quick start:
#   make debug-build         # build the debug bitstream
#   make debug-program       # program it to the FPGA
#   make debug-read-all      # read all registers via System Console
#   make debug-write-led VALUE=0xFF  # write LED_PATTERN and verify
#   make debug-dump          # Python debug_console.py dump (all registers + fields)
#   make debug-poll REG=EVENTS COUNT=10 INTERVAL=0.5  # poll a register
#
# debug-qsys overwrites the .qsys of the normal design, and qsys reuses an
# existing .qsys. To build the normal design again, run `make clean` first.

# debug-qsys: Generate the .qsys from the debug variant TCL (adds JTAG master)
debug-qsys: | check-toolchain
	$(TOOL_RUN) "$(TOOL_CWD) && cd ../qsys && qsys-script --script=led_avmm_system_debug.tcl $(QSYS_SEARCH)"
	$(TOOL_RUN) "$(TOOL_CWD) && qsys-generate $(QSYS_FILE) --synthesis=VHDL --output-directory=$(QSYS_GEN_DIR) $(QSYS_SEARCH)"

# debug-build: Full build of the debug variant (qsys + project + compile)
debug-build: debug-qsys
	$(TOOL_RUN) "$(TOOL_CWD) && quartus_sh -t de10_nano_project.tcl && \
	  quartus_sh --flow compile $(PROJECT_NAME) -c $(REVISION_NAME)"

# debug-program: Program the debug variant bitstream to the FPGA
debug-program: program-sof

# debug-read-all: Read all led_controller_avmm registers via System Console Tcl
debug-read-all: usb-wsl
	$(JTAG_RUN) "$(TOOL_CWD) && $(JTAG_UP) \
	  printf 'source $(DEBUG_DIR)/read_all_registers.tcl\n' | system-console --cli $(JTAG_DOWN)"

# debug-write-led: Write LED_PATTERN register and verify readback
#   Usage: make debug-write-led VALUE=0xFF
debug-write-led: usb-wsl
	$(eval VAL := $(or $(VALUE),0xFF))
	$(JTAG_RUN) "$(TOOL_CWD) && $(JTAG_UP) \
	  printf 'set script_args {$(VAL)}\nsource $(DEBUG_DIR)/write_led_pattern.tcl\n' | system-console --cli $(JTAG_DOWN)"

# debug-dump: Python debug_console.py dump (all registers + field decode)
debug-dump: usb-wsl
	$(JTAG_RUN) "$(TOOL_CWD) && $(JTAG_UP) \
	  python3 $(DEBUG_DIR)/debug_console.py --base $(LED_CTRL_BASE) --timeout 60 dump $(JTAG_DOWN)"

# debug-poll: Poll a register repeatedly (Watch feature prototype)
#   Usage: make debug-poll REG=EVENTS COUNT=10 INTERVAL=0.5
debug-poll: usb-wsl
	$(eval REG := $(or $(REG),EVENTS))
	$(eval COUNT := $(or $(COUNT),10))
	$(eval INTERVAL := $(or $(INTERVAL),0.5))
	$(JTAG_RUN) "$(TOOL_CWD) && $(JTAG_UP) \
	  python3 $(DEBUG_DIR)/debug_console.py --base $(LED_CTRL_BASE) --timeout 60 poll $(REG) $(COUNT) $(INTERVAL) $(JTAG_DOWN)"

# ── Clean ─────────────────────────────────────────────────────────────────────
clean:
	$(TOOL_RUN) "$(TOOL_CWD) && \
	  rm -rf db incremental_db output_files && \
	  rm -rf $(QSYS_GEN_DIR) $(QSYS_FILE) $(SOPCINFO) && \
	  rm -rf $(BSP_DIR) $(APP_BUILD_DIR) && \
	  find . -maxdepth 1 \( -name '*.rpt' -o -name '*.summary' -o -name '*.qsf' \
	    -o -name '*.qpf' -o -name '*.qws' -o -name '*.done' -o -name '*.smsg' \
	    -o -name '*.jdi' -o -name '*.pin' -o -name '*.sld' -o -name '*.sof' \
	    -o -name 'dump.txt' \) -delete"

help:
	@echo "Nios V targets: all/hardware, qsys, project, compile, software, bsp, app,"
	@echo "  program-sof, download-elf, terminal, clean"
	@echo "Debug targets: debug-qsys, debug-build, debug-program, debug-read-all,"
	@echo "  debug-write-led, debug-dump, debug-poll"
	@echo "Set USE_DOCKER=0|1 to choose the tools, USBIPD_BUSID=<id> for usbipd (WSL2)."
	@echo "qsys reuses an existing .qsys: after debug-build, run 'make clean' before"
	@echo "building the normal design again."
