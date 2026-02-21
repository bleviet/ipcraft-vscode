import React, { useMemo } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { calculateBlockSize } from '../utils/blockSize';

export interface VisualizerAddressBlock {
  name?: string;
  base_address?: number | string;
  offset?: number | string;
  size?: number | string;
  range?: number | string;
  usage?: string;
  registers?: Array<{
    __kind?: string;
    count?: number | string;
    stride?: number | string;
  }>;
}

interface AddressMapVisualizerProps {
  blocks: VisualizerAddressBlock[];
  hoveredBlockIndex?: number | null;
  setHoveredBlockIndex?: (idx: number | null) => void;
  onBlockClick?: (blockIndex: number) => void;
}

function getBlockColor(idx: number) {
  return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
}

const AddressMapVisualizerInner: React.FC<AddressMapVisualizerProps> = ({
  blocks,
  hoveredBlockIndex = null,
  setHoveredBlockIndex = (_idx: number | null) => undefined,
  onBlockClick,
}) => {
  // Group blocks by address ranges
  const groups = useMemo(() => {
    return blocks.map((block, idx) => {
      const base = block.base_address ?? block.offset ?? 0;
      const size = calculateBlockSize(block);
      return {
        idx,
        name: block.name ?? `Block ${idx}`,
        start: Number(base),
        end: Number(base) + Number(size) - 1,
        size,
        color: getBlockColor(idx),
        usage: block.usage ?? 'register',
      };
    });
  }, [blocks]);

  return (
    <div className="w-full">
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        {/* Address grid background */}
        {/* <div className="absolute inset-0 pointer-events-none fpga-bit-grid-bg bg-[size:32px_48px] rounded-lg" /> */}
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {groups.map((group, groupIdx) => {
            const isHovered = hoveredBlockIndex === group.idx;
            const separatorShadow = 'inset 0 0 0 1px var(--vscode-panel-border)';
            return (
              <div
                key={group.idx}
                className={`relative flex-1 flex flex-col items-center justify-end select-none min-w-[120px] ${isHovered ? 'z-10' : ''}`}
                style={{ cursor: onBlockClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoveredBlockIndex(group.idx)}
                onMouseLeave={() => setHoveredBlockIndex(null)}
                onClick={() => onBlockClick?.(group.idx)}
              >
                <div
                  className="h-20 w-full overflow-hidden flex items-center justify-center px-2 rounded-md"
                  style={{
                    backgroundColor: FIELD_COLORS[group.color],
                    opacity: 1,
                    transform: isHovered ? 'translateY(-2px)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isHovered
                      ? `${separatorShadow}, 0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
                      : separatorShadow,
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="ipcraft-pattern-label text-[10px] font-mono font-semibold select-none text-center leading-tight">
                      {group.usage === 'memory' ? 'MEM' : 'REG'}
                    </span>
                  </div>
                </div>
                <div
                  className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${
                    groupIdx === 0 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                  style={{
                    background: 'var(--vscode-editorWidget-background)',
                    color: 'var(--vscode-foreground)',
                    borderColor: 'var(--vscode-panel-border)',
                  }}
                >
                  <div className="font-bold">
                    {group.name}
                    <span className="ml-2 vscode-muted font-mono text-[11px]">
                      [{toHex(group.start)}:{toHex(group.end)}]
                    </span>
                  </div>
                  <div className="text-[11px] vscode-muted font-mono">
                    {group.size < 1024
                      ? `${group.size}B`
                      : group.size < 1048576
                        ? `${(group.size / 1024).toFixed(1)}KB`
                        : `${(group.size / 1048576).toFixed(1)}MB`}
                  </div>
                </div>
                <div className="flex w-full justify-center">
                  <div className="text-center text-[11px] vscode-muted font-mono mt-1">
                    {toHex(group.start)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const AddressMapVisualizer = React.memo(
  AddressMapVisualizerInner,
  (prev, next) =>
    prev.blocks === next.blocks &&
    prev.hoveredBlockIndex === next.hoveredBlockIndex &&
    prev.setHoveredBlockIndex === next.setHoveredBlockIndex &&
    prev.onBlockClick === next.onBlockClick
);

export default AddressMapVisualizer;
