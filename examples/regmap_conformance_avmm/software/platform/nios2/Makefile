# Nios II application Makefile.
# The BSP must be generated and built before this Makefile is invoked.
# See ../../../altera/quartus/Makefile which handles the full build pipeline.
#
# SRCS pulls in the portable check sequence from ../../app/ directly --
# that file is the single source of truth for the conformance sequence;
# this directory only supplies the Nios II HAL (platform.c) and BSP glue.

BSP_DIR  := bsp
ELF      := regmap_conformance_test.elf
SRCS     := main.c platform.c ../../app/conformance_checks.c

CC       := nios2-elf-gcc
CFLAGS   := -DALT_SINGLE_THREADED=1 -DNIOS2 \
             -I$(BSP_DIR) \
             -I$(BSP_DIR)/HAL/inc \
             -I$(BSP_DIR)/drivers/inc \
             -I../../app \
             -Os -g -Wall -Wextra \
             -mno-hw-div -mno-hw-mul

LDFLAGS  := -T$(BSP_DIR)/linker.x \
             -L$(BSP_DIR) -lhal_bsp \
             -Wl,--gc-sections

.PHONY: all clean

all: $(ELF)

$(ELF): $(SRCS) $(BSP_DIR)/linker.x
	$(CC) $(CFLAGS) $(SRCS) -o $@ $(LDFLAGS)
	nios2-elf-size $@

clean:
	rm -f $(ELF)
