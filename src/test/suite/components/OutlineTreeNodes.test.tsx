import React from 'react';
import { render } from '@testing-library/react';
import OutlineTreeNodes from '../../../webview/components/outline/OutlineTreeNodes';
import type { NormalizedMemoryMap } from '../../../domain/internal.types';
import '@testing-library/jest-dom';

describe('OutlineTreeNodes overlap warning rendering', () => {
  const onToggleExpand = jest.fn();
  const onFocusTree = jest.fn();
  const onSelect = jest.fn();
  const renderNameOrEdit = (id: string, name: string) => <span>{name}</span>;

  it('renders a warning icon next to overlapping address blocks', () => {
    const memoryMap: NormalizedMemoryMap = {
      name: 'Test Map',
      description: 'Test Map Desc',
      addressBlocks: [
        {
          rowId: 'block-0',
          name: 'BLOCK_0',
          baseAddress: 0x0,
          range: '4K', // size 4096, end 4095
          usage: 'memory',
          description: '',
          defaultRegWidth: 32,
          registers: [],
        },
        {
          rowId: 'block-1',
          name: 'BLOCK_1',
          baseAddress: 0x100, // overlapping range [256 : 1279]
          range: '1K', // size 1024, end 1279
          usage: 'memory',
          description: '',
          defaultRegWidth: 32,
          registers: [],
        },
        {
          rowId: 'block-2',
          name: 'BLOCK_2',
          baseAddress: 0x2000, // non-overlapping
          range: '4K',
          usage: 'memory',
          description: '',
          defaultRegWidth: 32,
          registers: [],
        },
      ],
    };

    const filteredBlocks = memoryMap.addressBlocks.map((block, index) => ({
      block,
      index,
    }));

    const { container } = render(
      <OutlineTreeNodes
        memoryMap={memoryMap}
        memoryMapName="Test Map"
        filteredBlocks={filteredBlocks}
        query=""
        selectedId={null}
        expanded={new Set()}
        onToggleExpand={onToggleExpand}
        onFocusTree={onFocusTree}
        onSelect={onSelect}
        renderNameOrEdit={renderNameOrEdit}
      />
    );

    // Block 0 and Block 1 overlap, they should have warning icons
    // Block 2 does not overlap, it should not have a warning icon
    const block0Row = container.querySelector('[data-outline-id="block-0"]');
    const block1Row = container.querySelector('[data-outline-id="block-1"]');
    const block2Row = container.querySelector('[data-outline-id="block-2"]');

    expect(block0Row?.querySelector('.codicon-warning')).toBeInTheDocument();
    expect(block1Row?.querySelector('.codicon-warning')).toBeInTheDocument();
    expect(block2Row?.querySelector('.codicon-warning')).not.toBeInTheDocument();
  });
});
