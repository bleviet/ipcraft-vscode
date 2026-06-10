import {
  insertElement,
  deleteElement,
  relocateElement,
} from '../../../webview/algorithms/MutationService';
import type { LayoutMemoryMap } from '../../../webview/algorithms/LayoutEngine';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeMap(overrides?: Partial<LayoutMemoryMap>): LayoutMemoryMap {
  return {
    name: 'test_map',
    addressBlocks: [
      {
        name: 'BLOCK0',
        base_address: 0,
        registers: [
          {
            name: 'REG0',
            offset: 0,
            address_offset: 0,
            fields: [
              { name: 'field0', bits: '[7:0]', bit_offset: 0, bit_width: 8 },
              { name: 'field1', bits: '[15:8]', bit_offset: 8, bit_width: 8 },
            ],
          },
          {
            name: 'REG1',
            offset: 4,
            address_offset: 4,
          },
          {
            name: 'REG2',
            offset: 8,
            address_offset: 8,
          },
        ],
      },
      {
        name: 'BLOCK1',
        base_address: 12,
        registers: [
          { name: 'REG0', offset: 0, address_offset: 0 },
          { name: 'REG1', offset: 4, address_offset: 4 },
        ],
      },
    ],
    ...overrides,
  };
}

function getBlocks(map: LayoutMemoryMap) {
  return map.addressBlocks ?? map.address_blocks ?? [];
}

// ---------------------------------------------------------------------------
// insertElement
// ---------------------------------------------------------------------------

describe('MutationService.insertElement', () => {
  describe('block layer', () => {
    it('should insert a block after the specified index', () => {
      const map = makeMap();
      const result = insertElement(map, 'block', 'after', 0);

      expect(result.errors).toEqual([]);
      const blocks = getBlocks(result.memoryMap);
      expect(blocks).toHaveLength(3);
      expect(blocks[1].name).toBe('block1');
      expect(result.newIndex).toBe(1);
    });

    it('should insert a block before the specified index', () => {
      const map = makeMap();
      const result = insertElement(map, 'block', 'before', 1);

      expect(result.errors).toEqual([]);
      const blocks = getBlocks(result.memoryMap);
      expect(blocks).toHaveLength(3);
      // New block inserted before BLOCK1
      expect(blocks[1].name).toBe('block1');
    });

    it('should insert into empty blocks array', () => {
      const map: LayoutMemoryMap = { name: 'empty', addressBlocks: [] };
      const result = insertElement(map, 'block', 'after', -1);

      const blocks = getBlocks(result.memoryMap);
      expect(blocks).toHaveLength(1);
      expect(result.newIndex).toBe(0);
    });

    it('should recompute all block base addresses after insertion', () => {
      const map = makeMap();
      const result = insertElement(map, 'block', 'after', 0);

      const blocks = getBlocks(result.memoryMap);
      // BLOCK0: 3 regs = 12 bytes -> base 0
      // new block: 1 reg = 4 bytes -> base 12
      // BLOCK1: 2 regs = 8 bytes -> base 16
      expect(blocks[0].base_address).toBe(0);
      expect(blocks[1].base_address).toBe(12);
      expect(blocks[2].base_address).toBe(16);
    });
  });

  describe('register layer', () => {
    it('should insert a register after the specified index', () => {
      const map = makeMap();
      const result = insertElement(map, 'register', 'after', 1, { blockIndex: 0 });

      const regs = getBlocks(result.memoryMap)[0].registers!;
      expect(regs).toHaveLength(4);
      expect(regs[2].name).toBe('reg1');
      expect(result.newIndex).toBe(2);
    });

    it('should insert a register before the specified index', () => {
      const map = makeMap();
      const result = insertElement(map, 'register', 'before', 0, { blockIndex: 0 });

      const regs = getBlocks(result.memoryMap)[0].registers!;
      expect(regs).toHaveLength(4);
      expect(regs[0].name).toBe('reg1');
    });

    it('should recompute register offsets after insertion', () => {
      const map = makeMap();
      const result = insertElement(map, 'register', 'after', 0, { blockIndex: 0 });

      const regs = getBlocks(result.memoryMap)[0].registers!;
      expect(regs[0].address_offset).toBe(0);
      expect(regs[1].address_offset).toBe(4);
      expect(regs[2].address_offset).toBe(8);
      expect(regs[3].address_offset).toBe(12);
    });

    it('should cascade to downstream block base addresses', () => {
      const map = makeMap();
      const result = insertElement(map, 'register', 'after', 0, { blockIndex: 0 });

      const blocks = getBlocks(result.memoryMap);
      // BLOCK0 now has 4 regs = 16 bytes
      expect(blocks[0].base_address).toBe(0);
      expect(blocks[1].base_address).toBe(16);
    });
  });

  describe('field layer', () => {
    it('should insert a field after the specified index', () => {
      const map = makeMap();
      const result = insertElement(map, 'field', 'after', 0, { blockIndex: 0, registerIndex: 0 });

      const fields = getBlocks(result.memoryMap)[0].registers![0].fields!;
      expect(fields).toHaveLength(3);
    });

    it('should recompute bit ranges after insertion', () => {
      const map = makeMap();
      const result = insertElement(map, 'field', 'after', 0, { blockIndex: 0, registerIndex: 0 });

      const fields = getBlocks(result.memoryMap)[0].registers![0].fields!;
      // field0: 8 bits at [7:0]
      // new field1: 1 bit at [8:8]
      // old field1: 8 bits at [16:9]
      expect(fields[0].bits).toBe('[7:0]');
      expect(fields[1].bits).toBe('[8:8]');
      expect(fields[2].bits).toBe('[16:9]');
    });
  });
});

// ---------------------------------------------------------------------------
// deleteElement
// ---------------------------------------------------------------------------

describe('MutationService.deleteElement', () => {
  describe('block layer', () => {
    it('should delete a block and recompute layout', () => {
      const map = makeMap();
      const result = deleteElement(map, 'block', 0);

      const blocks = getBlocks(result.memoryMap);
      expect(blocks).toHaveLength(1);
      expect(blocks[0].name).toBe('BLOCK1');
      expect(blocks[0].base_address).toBe(0);
    });

    it('should return error for invalid index', () => {
      const map = makeMap();
      const result = deleteElement(map, 'block', 99);

      expect(result.newIndex).toBe(-1);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('register layer', () => {
    it('should delete a register and recompute offsets', () => {
      const map = makeMap();
      const result = deleteElement(map, 'register', 1, { blockIndex: 0 });

      const regs = getBlocks(result.memoryMap)[0].registers!;
      expect(regs).toHaveLength(2);
      expect(regs[0].name).toBe('REG0');
      expect(regs[1].name).toBe('REG2');
      expect(regs[1].address_offset).toBe(4); // repacked
    });

    it('should cascade to downstream block base addresses', () => {
      const map = makeMap();
      const result = deleteElement(map, 'register', 0, { blockIndex: 0 });

      const blocks = getBlocks(result.memoryMap);
      // BLOCK0 now has 2 regs = 8 bytes
      expect(blocks[1].base_address).toBe(8);
    });
  });

  describe('field layer', () => {
    it('should delete a field and recompute bit ranges', () => {
      const map = makeMap();
      const result = deleteElement(map, 'field', 0, { blockIndex: 0, registerIndex: 0 });

      const fields = getBlocks(result.memoryMap)[0].registers![0].fields!;
      expect(fields).toHaveLength(1);
      expect(fields[0].name).toBe('field1');
      expect(fields[0].bits).toBe('[7:0]'); // repacked to LSB
    });
  });
});

// ---------------------------------------------------------------------------
// relocateElement
// ---------------------------------------------------------------------------

describe('MutationService.relocateElement', () => {
  describe('block layer', () => {
    it('should swap block order and recompute base addresses', () => {
      const map = makeMap();
      const result = relocateElement(
        map,
        'block',
        0, // source index
        { blockIndex: 0 }, // source parent (unused for blocks)
        { blockIndex: 0 }, // target parent (unused for blocks)
        1 // target index
      );

      const blocks = getBlocks(result.memoryMap);
      // BLOCK1 (2 regs = 8 bytes) is now first, BLOCK0 (3 regs = 12 bytes) is second
      expect(blocks[0].name).toBe('BLOCK1');
      expect(blocks[1].name).toBe('BLOCK0');
      expect(blocks[0].base_address).toBe(0);
      expect(blocks[1].base_address).toBe(8);
    });
  });

  describe('register layer -- same block', () => {
    it('should move register within a block and recompute offsets', () => {
      const map = makeMap();
      // Move REG2 (index 2) to position 0
      const result = relocateElement(map, 'register', 2, { blockIndex: 0 }, { blockIndex: 0 }, 0);

      const regs = getBlocks(result.memoryMap)[0].registers!;
      expect(regs[0].name).toBe('REG2');
      expect(regs[1].name).toBe('REG0');
      expect(regs[2].name).toBe('REG1');
      expect(regs[0].address_offset).toBe(0);
      expect(regs[1].address_offset).toBe(4);
      expect(regs[2].address_offset).toBe(8);
    });
  });

  describe('register layer -- cross block', () => {
    it('should move register to a different block and recompute both blocks', () => {
      const map = makeMap();
      // Move REG0 from BLOCK0 to BLOCK1 at position 0
      const result = relocateElement(map, 'register', 0, { blockIndex: 0 }, { blockIndex: 1 }, 0);

      const blocks = getBlocks(result.memoryMap);
      // BLOCK0 now has 2 regs
      expect(blocks[0].registers).toHaveLength(2);
      expect(blocks[0].registers![0].name).toBe('REG1');
      expect(blocks[0].registers![0].address_offset).toBe(0);
      expect(blocks[0].registers![1].name).toBe('REG2');
      expect(blocks[0].registers![1].address_offset).toBe(4);

      // BLOCK1 now has 3 regs
      expect(blocks[1].registers).toHaveLength(3);
      expect(blocks[1].registers![0].name).toBe('REG0');
      expect(blocks[1].registers![0].address_offset).toBe(0);

      // Block base addresses recomputed
      expect(blocks[0].base_address).toBe(0);
      expect(blocks[1].base_address).toBe(8); // BLOCK0 has 2 regs = 8 bytes
    });
  });

  describe('field layer -- same register', () => {
    it('should reorder fields within a register and recompute bit ranges', () => {
      const map = makeMap();
      // Move field1 (index 1) to position 0 -- swap order
      const result = relocateElement(
        map,
        'field',
        1,
        { blockIndex: 0, registerIndex: 0 },
        { blockIndex: 0, registerIndex: 0 },
        0
      );

      const fields = getBlocks(result.memoryMap)[0].registers![0].fields!;
      // field1 (8 bits) is now first -> [7:0]
      // field0 (8 bits) is now second -> [15:8]
      expect(fields[0].name).toBe('field1');
      expect(fields[0].bits).toBe('[7:0]');
      expect(fields[1].name).toBe('field0');
      expect(fields[1].bits).toBe('[15:8]');
    });
  });

  describe('field layer -- cross register', () => {
    it('should move field to a different register and recompute both', () => {
      const map = makeMap();
      // Move field0 from BLOCK0.REG0 to BLOCK1.REG0 (which has no fields)
      const result = relocateElement(
        map,
        'field',
        0,
        { blockIndex: 0, registerIndex: 0 },
        { blockIndex: 1, registerIndex: 0 },
        0
      );

      const srcFields = getBlocks(result.memoryMap)[0].registers![0].fields!;
      const tgtFields = getBlocks(result.memoryMap)[1].registers![0].fields!;

      // Source register now has 1 field, repacked to [7:0]
      expect(srcFields).toHaveLength(1);
      expect(srcFields[0].name).toBe('field1');
      expect(srcFields[0].bits).toBe('[7:0]');

      // Target register now has 1 field at [7:0]
      expect(tgtFields).toHaveLength(1);
      expect(tgtFields[0].name).toBe('field0');
      expect(tgtFields[0].bits).toBe('[7:0]');
    });
  });

  describe('error handling', () => {
    it('should return error for invalid source index', () => {
      const map = makeMap();
      const result = relocateElement(map, 'register', 99, { blockIndex: 0 }, { blockIndex: 0 }, 0);

      expect(result.newIndex).toBe(-1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return error for invalid block index', () => {
      const map = makeMap();
      const result = relocateElement(map, 'register', 0, { blockIndex: 99 }, { blockIndex: 0 }, 0);

      expect(result.newIndex).toBe(-1);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should not mutate the original memory map', () => {
      const map = makeMap();
      const originalName = getBlocks(map)[0].registers![0].name;

      relocateElement(map, 'register', 0, { blockIndex: 0 }, { blockIndex: 1 }, 0);

      expect(getBlocks(map)[0].registers![0].name).toBe(originalName);
      expect(getBlocks(map)[0].registers).toHaveLength(3);
    });
  });
});
