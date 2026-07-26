# Processor-generation dispatcher for the DE10-Nano hardware example.
#
# Quartus 23.x: make PROCESSOR=nios2 [USE_DOCKER=1]
# Quartus 24.x+: make PROCESSOR=niosv
# Default: select Nios V when its component is installed, otherwise Nios II.

PROCESSOR ?= auto
QUARTUS_ROOT := $(if $(QUARTUS_ROOTDIR),$(QUARTUS_ROOTDIR),$(realpath $(dir $(shell command -v quartus_sh 2>/dev/null))/..))
ALTERA_ROOT := $(realpath $(QUARTUS_ROOT)/..)
NIOSV_COMPONENT := $(firstword $(wildcard $(ALTERA_ROOT)/ip/altera/soft_processor/intel_niosv_m/intel_niosv_m_hw.tcl))

ifeq ($(PROCESSOR),auto)
RESOLVED_PROCESSOR := $(if $(NIOSV_COMPONENT),niosv,nios2)
else ifneq ($(filter $(PROCESSOR),nios2 niosv),)
RESOLVED_PROCESSOR := $(PROCESSOR)
else
$(error PROCESSOR must be auto, nios2, or niosv)
endif

PLATFORM_DIR := platforms/$(RESOLVED_PROCESSOR)/quartus
BACKEND_ARG := $(if $(filter undefined,$(origin USE_DOCKER)),,USE_DOCKER=$(USE_DOCKER))
TARGETS := all qsys project compile hardware bsp app software sim clean program-sof \
           download-elf terminal quartus-gui platform-designer irq-metadata help

.PHONY: $(TARGETS) processor

all qsys project compile hardware bsp app software sim clean program-sof download-elf terminal quartus-gui platform-designer irq-metadata:
	@echo "Using $(RESOLVED_PROCESSOR) ($(PLATFORM_DIR))"
	+$(MAKE) -C $(PLATFORM_DIR) $@ $(BACKEND_ARG)

processor:
	@echo $(RESOLVED_PROCESSOR)

help:
	@echo "Usage: make [PROCESSOR=auto|nios2|niosv] [USE_DOCKER=0|1] <target>"
	@echo "Auto-selected processor: $(RESOLVED_PROCESSOR)"
	@echo "Targets: all hardware qsys project compile software bsp app program-sof download-elf terminal clean"
