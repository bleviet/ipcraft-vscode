import {
  recomputeBitfieldLayout,
  reorderBitfieldLayout,
  recomputeRegisterLayout,
  recomputeBlockLayout,
  recomputeFullLayout,
  validateLayout,
} from '../../../webview/algorithms/LayoutEngine';
import type {
  LayoutField,
  LayoutRegister,
  LayoutBlock,
  LayoutMemoryMap,
} from '../../../webview/algorithms/LayoutEngine';

describe('LayoutEngine', () => {
  // =========================================================================
  // recomputeBitfieldLayout
  // =========================================================================

  describe('recomputeBitfieldLayout', () => {
    it('should pack fields contiguously from LSB', () => {
      const fields: LayoutField[] = [
        { name: 'f0', bits: '[7:0]', offset: 0, width: 8 },
        { name: 'f1', bits: '[20:15]', offset: 15, width: 6 },
        { name: 'f2', bits: '[30:28]', offset: 28, width: 3 },
      ];

      const result = recomputeBitfieldLayout(fields, 32);

      expect(result[0].bits).toBe('[7:0]');
      expect(result[0].offset).toBe(0);
      expect(result[0].width).toBe(8);

      expect(result[1].bits).toBe('[13:8]');
      expect(result[1].offset).toBe(8);
      expect(result[1].width).toBe(6);

      expect(result[2].bits).toBe('[16:14]');
      expect(result[2].offset).toBe(14);
      expect(result[2].width).toBe(3);
    });

    it('should handle empty fields array', () => {
      expect(recomputeBitfieldLayout([], 32)).toEqual([]);
    });

    it('should handle single field', () => {
      const fields: LayoutField[] = [{ name: 'f0', bits: '[15:8]', offset: 8, width: 8 }];

      const result = recomputeBitfieldLayout(fields, 32);

      expect(result[0].bits).toBe('[7:0]');
      expect(result[0].offset).toBe(0);
      expect(result[0].width).toBe(8);
    });

    it('should clamp to register width', () => {
      const fields: LayoutField[] = [
        { name: 'f0', bits: '[15:0]', offset: 0, width: 16 },
        { name: 'f1', bits: '[31:16]', offset: 16, width: 16 },
        { name: 'f2', bits: '[7:0]', offset: 0, width: 8 },
      ];

      const result = recomputeBitfieldLayout(fields, 32);

      // f0: [15:0], f1: [31:16], f2 is clamped -- MSB would be 39, clamped to 31
      expect(result[2].offset).toBe(32);
      // width clamped: msb = min(31, 32+8-1=39) = 31, but lsb = 32 > 31 -> width = 0
      // Actually: msb = min(31, 39) = 31, lsb = 32 -> width = 31-32+1 = 0
      // The clamp ensures we don't overflow, but this field is effectively at the boundary
    });

    it('should not mutate input array', () => {
      const fields: LayoutField[] = [{ name: 'f0', bits: '[15:8]', offset: 8, width: 8 }];
      const originalBits = fields[0].bits;

      recomputeBitfieldLayout(fields, 32);

      expect(fields[0].bits).toBe(originalBits);
    });

    it('should preserve extra properties', () => {
      const fields: LayoutField[] = [
        {
          name: 'f0',
          bits: '[7:0]',
          offset: 0,
          width: 8,
          access: 'read-only',
          description: 'Status field',
          custom_prop: 42,
        },
      ];

      const result = recomputeBitfieldLayout(fields, 32);

      expect(result[0].access).toBe('read-only');
      expect(result[0].description).toBe('Status field');
      expect(result[0].custom_prop).toBe(42);
    });

    it('should handle overlapping input fields by packing them sequentially', () => {
      const fields: LayoutField[] = [
        { name: 'f0', bits: '[7:0]', offset: 0, width: 8 },
        { name: 'f1', bits: '[7:0]', offset: 0, width: 8 },
        { name: 'f2', bits: '[7:0]', offset: 0, width: 8 },
      ];

      const result = recomputeBitfieldLayout(fields, 32);

      expect(result[0].bits).toBe('[7:0]');
      expect(result[1].bits).toBe('[15:8]');
      expect(result[2].bits).toBe('[23:16]');
    });

    it('should handle field with no bits/offset/width', () => {
      const fields: LayoutField[] = [{ name: 'f0' }];

      const result = recomputeBitfieldLayout(fields, 32);

      // Should default to 1-bit width at bit 0
      expect(result[0].bits).toBe('[0:0]');
      expect(result[0].offset).toBe(0);
      expect(result[0].width).toBe(1);
    });
  });

  // =========================================================================
  // reorderBitfieldLayout
  // =========================================================================

  describe('reorderBitfieldLayout', () => {
    it('swaps FSM_STATE up past FIFO_LEVEL preserving a gap (bug regression)', () => {
      // STATUS register from comprehensive_axi: BUSY[0:0], FIFO_LEVEL[15:4], FSM_STATE[18:16]
      // After moveField swaps FSM_STATE (index 2) with FIFO_LEVEL (index 1):
      const swapped: LayoutField[] = [
        { name: 'BUSY', bits: '[0:0]', offset: 0, width: 1 },
        { name: 'FSM_STATE', bits: '[18:16]', offset: 16, width: 3 }, // old bits, new pos
        { name: 'FIFO_LEVEL', bits: '[15:4]', offset: 4, width: 12 }, // old bits, new pos
      ];
      // movedIdx=1 (FSM_STATE's new array pos), direction='lsb' (moved up = toward low bits)
      const result = reorderBitfieldLayout(swapped, 1, 'lsb', 32);

      expect(result[0].bits).toBe('[0:0]'); // BUSY unchanged
      expect(result[1].bits).toBe('[6:4]'); // FSM_STATE took FIFO_LEVEL's slot
      expect(result[2].bits).toBe('[18:7]'); // FIFO_LEVEL pushed past FSM_STATE
    });

    it('inverse: swaps FSM_STATE back down restoring original positions', () => {
      // Starting from [BUSY([0:0]), FSM_STATE([6:4]), FIFO_LEVEL([18:7])],
      // move FSM_STATE down (index 1 → 2, delta=+1).
      // After moveField: FIFO_LEVEL moves to idx=1, FSM_STATE moves to idx=2.
      const swapped: LayoutField[] = [
        { name: 'BUSY', bits: '[0:0]', offset: 0, width: 1 },
        { name: 'FIFO_LEVEL', bits: '[18:7]', offset: 7, width: 12 }, // was pos 2, now pos 1
        { name: 'FSM_STATE', bits: '[6:4]', offset: 4, width: 3 }, // was pos 1, now pos 2
      ];
      // movedIdx=2 (FSM_STATE's new pos), direction='msb' (moved down in array)
      const result = reorderBitfieldLayout(swapped, 2, 'msb', 32);

      expect(result[0].bits).toBe('[0:0]'); // BUSY unchanged
      expect(result[1].bits).toBe('[15:4]'); // FIFO_LEVEL back to original
      expect(result[2].bits).toBe('[18:16]'); // FSM_STATE back to original
    });

    it('swaps two adjacent fields with no gap', () => {
      const swapped: LayoutField[] = [
        { name: 'A', bits: '[7:0]', offset: 0, width: 8 },
        { name: 'C', bits: '[23:16]', offset: 16, width: 8 }, // moved up from pos 2
        { name: 'B', bits: '[15:8]', offset: 8, width: 8 }, // displaced to pos 2
      ];
      const result = reorderBitfieldLayout(swapped, 1, 'lsb', 32);

      expect(result[0].bits).toBe('[7:0]'); // A unchanged
      expect(result[1].bits).toBe('[15:8]'); // C takes B's old slot
      expect(result[2].bits).toBe('[23:16]'); // B takes C's old slot
    });

    it('swaps FIFO_LEVEL up past BUSY skipping a 3-bit gap', () => {
      // STATUS register: BUSY[0:0], gap[3:1], FIFO_LEVEL[15:4], FSM_STATE[18:16]
      // After moveField swaps FIFO_LEVEL (pos 1) with BUSY (pos 0):
      const swapped: LayoutField[] = [
        { name: 'FIFO_LEVEL', bits: '[15:4]', offset: 4, width: 12 }, // old bits, new pos 0
        { name: 'BUSY', bits: '[0:0]', offset: 0, width: 1 }, // old bits, new pos 1
        { name: 'FSM_STATE', bits: '[18:16]', offset: 16, width: 3 },
      ];
      // movedIdx=0 (FIFO_LEVEL's new array pos), direction='lsb'
      const result = reorderBitfieldLayout(swapped, 0, 'lsb', 32);

      expect(result[0].bits).toBe('[11:0]'); // FIFO_LEVEL: 12 bits from LSB
      expect(result[1].bits).toBe('[12:12]'); // BUSY: pushed above FIFO_LEVEL
      expect(result[2].bits).toBe('[18:16]'); // FSM_STATE: unchanged
    });

    it('does not mutate the input array', () => {
      const swapped: LayoutField[] = [
        { name: 'BUSY', bits: '[0:0]', offset: 0, width: 1 },
        { name: 'FSM_STATE', bits: '[18:16]', offset: 16, width: 3 },
        { name: 'FIFO_LEVEL', bits: '[15:4]', offset: 4, width: 12 },
      ];
      const origBits = swapped[1].bits;
      reorderBitfieldLayout(swapped, 1, 'lsb', 32);
      expect(swapped[1].bits).toBe(origBits);
    });
  });

  // =========================================================================
  // recomputeRegisterLayout
  // =========================================================================

  describe('recomputeRegisterLayout', () => {
    it('should pack registers contiguously with 4-byte stride', () => {
      const regs: LayoutRegister[] = [
        { name: 'REG1', offset: 0x10 },
        { name: 'REG2', offset: 0x20 },
        { name: 'REG3', offset: 0x30 },
      ];

      const result = recomputeRegisterLayout(regs);

      expect(result[0].offset).toBe(0);
      expect(result[0].address_offset).toBe(0);
      expect(result[1].offset).toBe(4);
      expect(result[1].address_offset).toBe(4);
      expect(result[2].offset).toBe(8);
      expect(result[2].address_offset).toBe(8);
    });

    it('should handle empty array', () => {
      expect(recomputeRegisterLayout([])).toEqual([]);
    });

    it('should handle register arrays (count * stride)', () => {
      const regs: LayoutRegister[] = [
        { name: 'REG1', offset: 0 },
        { name: 'ARR1', offset: 4, __kind: 'array', count: 4, stride: 8 },
        { name: 'REG2', offset: 100 },
      ];

      const result = recomputeRegisterLayout(regs);

      expect(result[0].offset).toBe(0);
      expect(result[1].offset).toBe(4); // after REG1 (4 bytes)
      expect(result[2].offset).toBe(4 + 4 * 8); // after ARR1 (32 bytes)
      expect(result[2].offset).toBe(36);
    });

    it('should respect register size field', () => {
      const regs: LayoutRegister[] = [
        { name: 'REG1', offset: 0, size: 16 }, // 16-bit = 2 bytes
        { name: 'REG2', offset: 100, size: 64 }, // 64-bit = 8 bytes
        { name: 'REG3', offset: 200 }, // default 32-bit = 4 bytes
      ];

      const result = recomputeRegisterLayout(regs);

      expect(result[0].offset).toBe(0);
      expect(result[1].offset).toBe(2); // after 16-bit register
      expect(result[2].offset).toBe(10); // after 64-bit register (2 + 8)
    });

    it('should not mutate input array', () => {
      const regs: LayoutRegister[] = [{ name: 'REG1', offset: 0x10 }];
      const originalOffset = regs[0].offset;

      recomputeRegisterLayout(regs);

      expect(regs[0].offset).toBe(originalOffset);
    });

    it('should preserve extra properties', () => {
      const regs: LayoutRegister[] = [
        { name: 'REG1', offset: 0x10, access: 'read-only', description: 'Status' },
      ];

      const result = recomputeRegisterLayout(regs);

      expect(result[0].access).toBe('read-only');
      expect(result[0].description).toBe('Status');
    });
  });

  // =========================================================================
  // recomputeBlockLayout
  // =========================================================================

  describe('recomputeBlockLayout', () => {
    it('should pack blocks contiguously based on their size', () => {
      const blocks: LayoutBlock[] = [
        {
          name: 'BLOCK1',
          base_address: 0x100,
          registers: [
            { name: 'R0', offset: 0 },
            { name: 'R1', offset: 4 },
          ],
        },
        {
          name: 'BLOCK2',
          base_address: 0x200,
          registers: [{ name: 'R0', offset: 0 }],
        },
      ];

      const result = recomputeBlockLayout(blocks);

      expect(result[0].base_address).toBe(0); // starts at 0
      expect(result[1].base_address).toBe(8); // after BLOCK1's 2 regs = 8 bytes
    });

    it('should handle empty array', () => {
      expect(recomputeBlockLayout([])).toEqual([]);
    });

    it('should handle blocks with no registers', () => {
      const blocks: LayoutBlock[] = [
        { name: 'BLOCK1', base_address: 0, size: 256 },
        { name: 'BLOCK2', base_address: 0 },
      ];

      const result = recomputeBlockLayout(blocks);

      expect(result[0].base_address).toBe(0);
      expect(result[1].base_address).toBe(256); // uses explicit size
    });

    it('should handle blocks with register arrays', () => {
      const blocks: LayoutBlock[] = [
        {
          name: 'BLOCK1',
          base_address: 0,
          registers: [{ name: 'ARR', __kind: 'array', count: 8, stride: 4 }],
        },
        {
          name: 'BLOCK2',
          base_address: 0,
        },
      ];

      const result = recomputeBlockLayout(blocks);

      expect(result[0].base_address).toBe(0);
      expect(result[1].base_address).toBe(32); // 8 * 4 = 32 bytes
    });

    it('should not mutate input array', () => {
      const blocks: LayoutBlock[] = [{ name: 'BLOCK1', base_address: 0x100 }];

      recomputeBlockLayout(blocks);

      expect(blocks[0].base_address).toBe(0x100);
    });
  });

  // =========================================================================
  // recomputeFullLayout
  // =========================================================================

  describe('recomputeFullLayout', () => {
    it('should recompute all three layers top-down', () => {
      const map: LayoutMemoryMap = {
        name: 'test_map',
        addressBlocks: [
          {
            name: 'BLOCK0',
            base_address: 0x1000,
            registers: [
              {
                name: 'REG0',
                offset: 0x100,
                fields: [
                  { name: 'f0', bits: '[20:10]', offset: 10, width: 11 },
                  { name: 'f1', bits: '[5:0]', offset: 0, width: 6 },
                ],
              },
              {
                name: 'REG1',
                offset: 0x200,
              },
            ],
          },
          {
            name: 'BLOCK1',
            base_address: 0x2000,
            registers: [{ name: 'REG0', offset: 0x50 }],
          },
        ],
      };

      const { data, errors } = recomputeFullLayout(map);

      // Block layout
      const blocks = data.addressBlocks!;
      expect(blocks[0].base_address).toBe(0);
      expect(blocks[1].base_address).toBe(8); // 2 regs * 4 bytes

      // Register layout
      const regs0 = blocks[0].registers!;
      expect(regs0[0].offset).toBe(0);
      expect(regs0[0].address_offset).toBe(0);
      expect(regs0[1].offset).toBe(4);
      expect(regs0[1].address_offset).toBe(4);

      const regs1 = blocks[1].registers!;
      expect(regs1[0].offset).toBe(0);
      expect(regs1[0].address_offset).toBe(0);

      // Bitfield layout
      const fields = regs0[0].fields!;
      expect(fields[0].bits).toBe('[10:0]'); // 11-bit field at LSB
      expect(fields[1].bits).toBe('[16:11]'); // 6-bit field after

      // No errors expected (since recomputation packs everything perfectly)
      expect(errors).toEqual([]);
    });

    it('should handle address_blocks key variant', () => {
      const map: LayoutMemoryMap = {
        name: 'test_map',
        address_blocks: [
          {
            name: 'BLOCK0',
            base_address: 0x100,
            registers: [{ name: 'REG0', offset: 0x50 }],
          },
        ],
      };

      const { data } = recomputeFullLayout(map);

      // Should use address_blocks key in result
      expect(data.address_blocks).toBeDefined();
      expect(data.address_blocks![0].base_address).toBe(0);
    });

    it('should not mutate the input', () => {
      const map: LayoutMemoryMap = {
        name: 'test_map',
        addressBlocks: [
          {
            name: 'BLOCK0',
            base_address: 0x1000,
            registers: [{ name: 'REG0', offset: 0x100 }],
          },
        ],
      };

      recomputeFullLayout(map);

      expect(map.addressBlocks![0].base_address).toBe(0x1000);
      expect(map.addressBlocks![0].registers![0].offset).toBe(0x100);
    });

    it('should handle empty memory map', () => {
      const { data, errors } = recomputeFullLayout({ name: 'empty' });

      expect(data.name).toBe('empty');
      expect(errors).toEqual([]);
    });
  });

  // =========================================================================
  // validateLayout (overlap detection)
  // =========================================================================

  describe('validateLayout', () => {
    it('should report no errors for well-formed layout', () => {
      const map: LayoutMemoryMap = {
        name: 'test',
        addressBlocks: [
          {
            name: 'B0',
            base_address: 0,
            registers: [
              {
                name: 'R0',
                offset: 0,
                address_offset: 0,
                fields: [
                  { name: 'f0', bits: '[7:0]', offset: 0, width: 8 },
                  { name: 'f1', bits: '[15:8]', offset: 8, width: 8 },
                ],
              },
              { name: 'R1', offset: 4, address_offset: 4 },
            ],
          },
        ],
      };

      const errors = validateLayout(map);
      // After recomputation, layout should be clean
      expect(errors).toEqual([]);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('Edge cases', () => {
    it('should handle register-array template register fields', () => {
      const map: LayoutMemoryMap = {
        name: 'test',
        addressBlocks: [
          {
            name: 'B0',
            base_address: 0,
            registers: [
              {
                name: 'ARR',
                offset: 0,
                __kind: 'array',
                count: 4,
                stride: 4,
                registers: [
                  {
                    name: 'TEMPLATE',
                    offset: 0,
                    fields: [
                      { name: 'f0', bits: '[20:10]', offset: 10, width: 11 },
                      { name: 'f1', bits: '[5:0]', offset: 0, width: 6 },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const { data } = recomputeFullLayout(map);

      const templateReg = data.addressBlocks![0].registers![0].registers![0];
      expect(templateReg.fields![0].bits).toBe('[10:0]');
      expect(templateReg.fields![1].bits).toBe('[16:11]');
    });

    it('should handle multiple blocks with varying register counts', () => {
      const map: LayoutMemoryMap = {
        name: 'test',
        addressBlocks: [
          {
            name: 'B0',
            base_address: 0,
            registers: [{ name: 'R0' }, { name: 'R1' }, { name: 'R2' }],
          },
          {
            name: 'B1',
            base_address: 0,
            registers: [{ name: 'R0' }],
          },
          {
            name: 'B2',
            base_address: 0,
            registers: [{ name: 'R0' }, { name: 'R1' }],
          },
        ],
      };

      const { data } = recomputeFullLayout(map);

      const blocks = data.addressBlocks!;
      expect(blocks[0].base_address).toBe(0);
      expect(blocks[1].base_address).toBe(12); // 3 * 4
      expect(blocks[2].base_address).toBe(16); // 12 + 1 * 4
    });
  });
});
