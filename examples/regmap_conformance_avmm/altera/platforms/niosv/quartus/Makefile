# Quartus 24.x+ / Nios V build for the DE10-Nano conformance design.

PROJECT_NAME  = regmap_conformance_avmm
REVISION_NAME = de10_nano
QSYS_TCL      = ../qsys/regmap_conformance_system.tcl
QSYS_FILE     = ../qsys/regmap_conformance_system.qsys
QSYS_GEN_DIR  = ../qsys/regmap_conformance_system_gen
SOPCINFO      = ../qsys/regmap_conformance_system.sopcinfo
BSP_DIR       = ../../../../software/platform/niosv/bsp
APP_SRC_DIR   = ../../../../software/platform/niosv
APP_BUILD_DIR = $(APP_SRC_DIR)/build
APP_ELF       = $(APP_BUILD_DIR)/regmap_conformance_test.elf
DEBUG_DIR     = ../../../debug
REPO_ROOT     = $(realpath ../../../../..)
PROJECT_ROOT  = $(REPO_ROOT)/$(PROJECT_NAME)
DOCKER_IMAGE ?= ipcraft-examples/quartus:25.1
USE_DOCKER ?= $(shell docker image inspect $(DOCKER_IMAGE) >/dev/null 2>&1 && echo 1 || echo 0)
DEVICE_INDEX ?= 2

ifeq ($(USE_DOCKER),1)
TOOL_RUN = docker run --rm --user $$(id -u):$$(id -g) -v $(REPO_ROOT):/work $(DOCKER_IMAGE) bash -c
TOOL_CWD = cd /work/$(PROJECT_NAME)/altera/platforms/niosv/quartus
TOOL_PROJECT_ROOT = /work/$(PROJECT_NAME)
TOOLCHAIN_CHECK = command -v docker >/dev/null 2>&1
else
NATIVE_QUARTUS_BIN := $(shell command -v quartus_sh 2>/dev/null)
NATIVE_QUARTUS_ROOT := $(if $(QUARTUS_ROOTDIR),$(QUARTUS_ROOTDIR),$(if $(NATIVE_QUARTUS_BIN),$(realpath $(dir $(NATIVE_QUARTUS_BIN))/..)))
ifeq ($(NATIVE_QUARTUS_ROOT),)
$(error Native Quartus not found. Set QUARTUS_ROOTDIR or add quartus_sh to PATH)
endif
NATIVE_ALTERA_ROOT := $(realpath $(NATIVE_QUARTUS_ROOT)/..)
NATIVE_ENV = env QUARTUS_ROOTDIR="$(NATIVE_QUARTUS_ROOT)" \
  QSYS_ROOTDIR="$(NATIVE_QUARTUS_ROOT)/sopc_builder/bin" \
  PATH="$(NATIVE_QUARTUS_ROOT)/bin:$(NATIVE_QUARTUS_ROOT)/sopc_builder/bin:$(NATIVE_ALTERA_ROOT)/niosv/bin:$$PATH"
TOOL_RUN = $(NATIVE_ENV) bash -c
TOOL_CWD = cd $(CURDIR)
TOOL_PROJECT_ROOT = $(PROJECT_ROOT)
NIOSV_COMPONENT = $(NATIVE_ALTERA_ROOT)/ip/altera/soft_processor/intel_niosv_m/intel_niosv_m_hw.tcl
TOOLCHAIN_CHECK = test -f "$(NIOSV_COMPONENT)" || { \
  echo "Quartus at $(NATIVE_ALTERA_ROOT) does not include intel_niosv_m." >&2; exit 1; }
endif

.PHONY: all hardware software check-toolchain check-compiler qsys project compile \
        bsp app sim clean program-sof download-elf terminal quartus-gui \
        platform-designer irq-metadata help

# The compiler is a separate Nios V prerequisite, so the default remains a
# complete FPGA hardware build. Use `make software` after installing it.
all: hardware
hardware: qsys project compile
software: bsp app

check-toolchain:
	@$(TOOLCHAIN_CHECK)

check-compiler:
	@$(TOOL_RUN) "$(TOOL_CWD) && command -v riscv32-unknown-elf-gcc >/dev/null 2>&1 || { \
	  echo 'Missing riscv32-unknown-elf-gcc required by the Nios V BSP.' >&2; \
	  echo 'Install the Altera Nios V RISC-V GNU toolchain, then retry make software.' >&2; exit 1; }"

sim:
	$(MAKE) -C ../../../../tb SIM=ghdl WAVES=0

$(QSYS_FILE): $(QSYS_TCL) | check-toolchain
	$(TOOL_RUN) "$(TOOL_CWD) && cd ../qsys && qsys-script --script=regmap_conformance_system.tcl --search-path=$(TOOL_PROJECT_ROOT)/altera/platforms/niosv/qsys,\$$"

qsys: $(QSYS_FILE)
	$(TOOL_RUN) "$(TOOL_CWD) && qsys-generate $(QSYS_FILE) --synthesis=VHDL --output-directory=$(QSYS_GEN_DIR) --search-path=$(TOOL_PROJECT_ROOT)/altera/platforms/niosv/qsys,\$$"

$(QSYS_GEN_DIR)/synthesis/regmap_conformance_system.qip: qsys

$(SOPCINFO): qsys

project: $(QSYS_GEN_DIR)/synthesis/regmap_conformance_system.qip
	$(TOOL_RUN) "$(TOOL_CWD) && quartus_sh -t de10_nano_project.tcl"

compile: project
	$(TOOL_RUN) "$(TOOL_CWD) && quartus_sh --flow compile $(PROJECT_NAME) -c $(REVISION_NAME)"

bsp: $(SOPCINFO)
	$(TOOL_RUN) "$(TOOL_CWD) && rm -rf $(BSP_DIR) && niosv-bsp $(BSP_DIR)/settings.bsp --create --sopcinfo=$(SOPCINFO) --type=hal --bsp-dir=$(BSP_DIR) --cpu-instance=niosv"

app: bsp | check-compiler
	$(TOOL_RUN) "$(TOOL_CWD) && rm -rf $(APP_BUILD_DIR) && mkdir -p $(APP_BUILD_DIR) && \
	  niosv-app --app-dir=$(APP_BUILD_DIR) --bsp-dir=$(BSP_DIR) \
	    --srcs=$(APP_SRC_DIR)/main.c,$(APP_SRC_DIR)/platform.c,../../../../software/app/conformance_checks.c \
	    --incs=../../../../software/app --elf-name=regmap_conformance_test.elf && \
	  cmake -S $(APP_BUILD_DIR) -B $(APP_BUILD_DIR) -DCMAKE_TOOLCHAIN_FILE=$(TOOL_PROJECT_ROOT)/software/platform/niosv/bsp/toolchain.cmake && \
	  cmake --build $(APP_BUILD_DIR)"

irq-metadata: bsp
	python3 $(DEBUG_DIR)/verify_irq_metadata.py --sopcinfo $(SOPCINFO) \
	  --system-header $(BSP_DIR)/system.h --cpu-module niosv --irq-interface platform_irq_rx

$(REVISION_NAME).sof: compile

program-sof: $(REVISION_NAME).sof
	quartus_pgm -m jtag -o "p;$(REVISION_NAME).sof@$(DEVICE_INDEX)"

$(APP_ELF): app

download-elf: $(APP_ELF)
	@if [ "$(USE_DOCKER)" = "1" ]; then \
	  echo "Nios V hardware download must run natively, not inside Docker." >&2; exit 1; \
	fi
	niosv-shell --wait --run "niosv-download -g $(APP_ELF)"

terminal:
	nios2-terminal

quartus-gui:
	$(TOOL_RUN) "$(TOOL_CWD) && quartus $(PROJECT_NAME).qpf 2>/dev/null || quartus"

platform-designer:
	$(TOOL_RUN) "$(TOOL_CWD) && qsys-edit $(QSYS_FILE) 2>/dev/null || qsys-edit"

clean:
	$(TOOL_RUN) "$(TOOL_CWD) && rm -rf db incremental_db output_files $(QSYS_GEN_DIR) $(QSYS_FILE) $(BSP_DIR) $(APP_BUILD_DIR) && find . -maxdepth 1 -type f \( -name '*.rpt' -o -name '*.summary' -o -name '*.qsf' -o -name '*.qpf' -o -name '*.sof' \) -delete"

help:
	@echo "Nios V targets: all/hardware, qsys, project, compile, software, bsp, app, program-sof, download-elf, terminal, clean"
