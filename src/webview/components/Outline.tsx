import React, { useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  MemoryMap,
  AddressBlock,
  Register,
  RegisterArray,
} from "../types/memoryMap";

type YamlPath = Array<string | number>;

type RegisterArrayNode = {
  __kind: "array";
  name: string;
  address_offset: number;
  count: number;
  stride: number;
  description?: string;
  registers: Register[];
};

const isArrayNode = (node: any): node is RegisterArrayNode => {
  return (
    !!node &&
    typeof node === "object" &&
    node.__kind === "array" &&
    typeof node.count === "number" &&
    typeof node.stride === "number"
  );
};

const toHex = (n: number) => `0x${Math.max(0, n).toString(16).toUpperCase()}`;

interface OutlineProps {
  memoryMap: MemoryMap;
  selectedId: string | null;
  onSelect: (selection: {
    id: string;
    type: "memoryMap" | "block" | "register" | "array";
    object: any;
    breadcrumbs: string[];
    path: YamlPath;
    meta?: {
      absoluteAddress?: number;
      relativeOffset?: number;
      focusDetails?: boolean;
    };
  }) => void;
  /** Called when user renames an item via F2 or 'e' key */
  onRename?: (path: YamlPath, newName: string) => void;
}

export type OutlineHandle = {
  focus: () => void;
};

const Outline = React.forwardRef<OutlineHandle, OutlineProps>(
  ({ memoryMap, selectedId, onSelect, onRename }, ref) => {
    // By default, expand all blocks and registers
    const allIds = useMemo(() => {
      const ids = new Set<string>(["root"]);
      (memoryMap.address_blocks ?? []).forEach((block, blockIdx) => {
        const blockId = `block-${blockIdx}`;
        ids.add(blockId);
        const regs = ((block as any).registers ?? []) as any[];
        regs.forEach((reg, regIdx) => {
          if (reg && reg.__kind === "array") {
            ids.add(`block-${blockIdx}-arrreg-${regIdx}`);
          }
        });
        ((block as any).register_arrays ?? []).forEach(
          (arr: any, arrIdx: number) => {
            ids.add(`block-${blockIdx}-arr-${arrIdx}`);
          },
        );
      });
      return ids;
    }, [memoryMap]);
    const [expanded, setExpanded] = useState<Set<string>>(allIds);
    const [query, setQuery] = useState("");
    const treeFocusRef = useRef<HTMLDivElement | null>(null);

    // Inline editing state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState("");
    const editInputRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          treeFocusRef.current?.focus();
        },
      }),
      [],
    );

    const toggleExpand = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const newExpanded = new Set(expanded);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      setExpanded(newExpanded);
    };

    /**
     * Start inline edit mode for the given item.
     */
    const startEditing = (id: string, currentName: string) => {
      if (!onRename) return;
      setEditingId(id);
      setEditingValue(currentName);
      // Focus input after render
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    };

    /**
     * Commit the rename and exit edit mode.
     */
    const commitEdit = (path: YamlPath) => {
      if (!onRename || !editingId) return;
      const trimmed = editingValue.trim();
      if (trimmed) {
        onRename([...path, "name"], trimmed);
      }
      setEditingId(null);
      setEditingValue("");
      treeFocusRef.current?.focus();
    };

    /**
     * Cancel editing without saving.
     */
    const cancelEdit = () => {
      setEditingId(null);
      setEditingValue("");
      treeFocusRef.current?.focus();
    };

    /**
     * Render either an inline edit input or the static name text.
     */
    const renderNameOrEdit = (
      id: string,
      name: string,
      path: YamlPath,
      className?: string,
    ) => {
      if (editingId === id) {
        return (
          <input
            ref={editInputRef}
            type="text"
            className="outline-inline-edit px-1 py-0 text-sm rounded border"
            style={{
              background: "var(--vscode-input-background)",
              color: "var(--vscode-input-foreground)",
              borderColor: "var(--vscode-focusBorder)",
              minWidth: "80px",
              width: `${Math.max(80, editingValue.length * 8)}px`,
            }}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(path);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelEdit();
              }
            }}
            onBlur={() => commitEdit(path)}
            onClick={(e) => e.stopPropagation()}
          />
        );
      }
      return <span className={className}>{name}</span>;
    };

    const renderLeafRegister = (
      reg: Register,
      blockIndex: number,
      regIndex: number,
    ) => {
      const id = `block-${blockIndex}-reg-${regIndex}`;
      const isSelected = selectedId === id;
      const block = memoryMap.address_blocks?.[blockIndex];
      const absolute = (block?.base_address ?? 0) + (reg.address_offset ?? 0);
      return (
        <div
          key={id}
          className={`tree-item ${isSelected ? "selected" : ""} gap-2 text-sm`}
          onClick={() => {
            treeFocusRef.current?.focus();
            onSelect({
              id,
              type: "register",
              object: reg,
              breadcrumbs: [
                memoryMap.name || "Memory Map",
                memoryMap.address_blocks?.[blockIndex]?.name ?? "",
                reg.name,
              ],
              path: ["addressBlocks", blockIndex, "registers", regIndex],
              meta: {
                absoluteAddress: absolute,
                relativeOffset: reg.address_offset ?? 0,
              },
            });
          }}
          style={{ paddingLeft: "40px" }}
        >
          <span
            className={`codicon codicon-symbol-variable text-[16px] ${isSelected ? "" : "opacity-70"}`}
          ></span>
          {renderNameOrEdit(
            id,
            reg.name,
            ["addressBlocks", blockIndex, "registers", regIndex],
            "flex-1",
          )}
          <span className="text-[10px] vscode-muted font-mono">
            {toHex(reg.address_offset)}
          </span>
        </div>
      );
    };

    const renderArrayRegister = (
      arr: RegisterArrayNode,
      block: AddressBlock,
      blockIndex: number,
      regIndex: number,
    ) => {
      const id = `block-${blockIndex}-arrreg-${regIndex}`;
      const isSelected = selectedId === id;
      const isExpanded = expanded.has(id);

      const start = (block.base_address ?? 0) + (arr.address_offset ?? 0);
      const end = start + Math.max(1, arr.count) * Math.max(1, arr.stride) - 1;

      return (
        <div key={id}>
          <div
            className={`tree-item ${isSelected ? "selected" : ""}`}
            onClick={() => {
              treeFocusRef.current?.focus();
              onSelect({
                id,
                type: "array",
                object: arr,
                breadcrumbs: [
                  memoryMap.name || "Memory Map",
                  block.name,
                  arr.name,
                ],
                path: ["addressBlocks", blockIndex, "registers", regIndex],
              });
            }}
            style={{ paddingLeft: "40px" }}
          >
            <span
              className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
              onClick={(e) => toggleExpand(id, e)}
              style={{ marginRight: "6px", cursor: "pointer" }}
            ></span>
            <span
              className="codicon codicon-symbol-array"
              style={{ marginRight: "6px" }}
            ></span>
            {renderNameOrEdit(id, arr.name, [
              "addressBlocks",
              blockIndex,
              "registers",
              regIndex,
            ])}{" "}
            <span className="opacity-50">
              @ {toHex(start)}-{toHex(end)} [{arr.count}]
            </span>
          </div>

          {isExpanded && (
            <div>
              {Array.from({ length: arr.count }).map((_, elementIndex) => {
                const elementId = `${id}-el-${elementIndex}`;
                const elementBase = start + elementIndex * arr.stride;
                const isElementSelected = selectedId === elementId;
                return (
                  <div key={elementId}>
                    <div
                      className={`tree-item ${isElementSelected ? "selected" : ""}`}
                      onClick={() => {
                        treeFocusRef.current?.focus();
                        onSelect({
                          id: elementId,
                          type: "array",
                          object: {
                            ...arr,
                            __element_index: elementIndex,
                            __element_base: elementBase,
                          },
                          breadcrumbs: [
                            memoryMap.name || "Memory Map",
                            block.name,
                            `${arr.name}[${elementIndex}]`,
                          ],
                          path: [
                            "addressBlocks",
                            blockIndex,
                            "registers",
                            regIndex,
                          ],
                        });
                      }}
                      style={{ paddingLeft: "60px" }}
                    >
                      <span
                        className="codicon codicon-symbol-namespace"
                        style={{ marginRight: "6px" }}
                      ></span>
                      {arr.name}[{elementIndex}]{" "}
                      <span className="opacity-50">@ {toHex(elementBase)}</span>
                    </div>

                    {arr.registers?.map((reg, childIndex) => {
                      const childId = `${elementId}-reg-${childIndex}`;
                      const isChildSelected = selectedId === childId;
                      const absolute = elementBase + (reg.address_offset ?? 0);
                      return (
                        <div
                          key={childId}
                          className={`tree-item ${isChildSelected ? "selected" : ""}`}
                          onClick={() => {
                            treeFocusRef.current?.focus();
                            onSelect({
                              id: childId,
                              type: "register",
                              object: reg,
                              breadcrumbs: [
                                memoryMap.name || "Memory Map",
                                block.name,
                                `${arr.name}[${elementIndex}]`,
                                reg.name,
                              ],
                              path: [
                                "addressBlocks",
                                blockIndex,
                                "registers",
                                regIndex,
                                "registers",
                                childIndex,
                              ],
                              meta: {
                                absoluteAddress: absolute,
                                relativeOffset: reg.address_offset ?? 0,
                              },
                            });
                          }}
                          style={{ paddingLeft: "80px" }}
                        >
                          <span
                            className="codicon codicon-symbol-variable"
                            style={{ marginRight: "6px" }}
                          ></span>
                          {renderNameOrEdit(childId, reg.name, [
                            "addressBlocks",
                            blockIndex,
                            "registers",
                            regIndex,
                            "registers",
                            childIndex,
                          ])}{" "}
                          <span className="opacity-50">
                            @ {toHex(absolute)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    };

    const renderArray = (arr: any, blockIndex: number, arrayIndex: number) => {
      const id = `block-${blockIndex}-arr-${arrayIndex}`;
      const isSelected = selectedId === id;
      const isExpanded = expanded.has(id);
      return (
        <div key={id}>
          <div
            className={`tree-item ${isSelected ? "selected" : ""}`}
            onClick={() => {
              treeFocusRef.current?.focus();
              onSelect({
                id,
                type: "array",
                object: arr,
                breadcrumbs: [
                  memoryMap.name || "Memory Map",
                  memoryMap.address_blocks?.[blockIndex]?.name ?? "",
                  arr.name,
                ],
                path: [
                  "addressBlocks",
                  blockIndex,
                  "register_arrays",
                  arrayIndex,
                ],
              });
            }}
            style={{ paddingLeft: "40px" }}
          >
            <span
              className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
              onClick={(e) => toggleExpand(id, e)}
              style={{ marginRight: "6px", cursor: "pointer" }}
            ></span>
            <span
              className="codicon codicon-symbol-array"
              style={{ marginRight: "6px" }}
            ></span>
            {renderNameOrEdit(id, arr.name, [
              "addressBlocks",
              blockIndex,
              "register_arrays",
              arrayIndex,
            ])}{" "}
            <span className="opacity-50">[{arr.count}]</span>
          </div>
          {isExpanded && Array.isArray(arr.children_registers) && (
            <div>
              {arr.children_registers.map((reg: Register, idx: number) =>
                renderLeafRegister(reg, blockIndex, idx),
              )}
            </div>
          )}
        </div>
      );
    };

    const renderBlock = (block: AddressBlock, blockIndex: number) => {
      const id = `block-${blockIndex}`;
      const isExpanded = expanded.has(id);
      const isSelected = selectedId === id;

      const regsAny = ((block as any).registers ?? []) as any[];

      return (
        <div key={id}>
          <div
            className={`tree-item ${isSelected ? "selected" : ""}`}
            onClick={() => {
              treeFocusRef.current?.focus();
              onSelect({
                id,
                type: "block",
                object: block,
                breadcrumbs: [memoryMap.name || "Memory Map", block.name],
                path: ["addressBlocks", blockIndex],
              });
            }}
            style={{ paddingLeft: "20px" }}
          >
            <span
              className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
              onClick={(e) => toggleExpand(id, e)}
              style={{ marginRight: "6px", cursor: "pointer" }}
            ></span>
            <span
              className="codicon codicon-package"
              style={{ marginRight: "6px" }}
            ></span>
            {renderNameOrEdit(id, block.name, ["addressBlocks", blockIndex])}{" "}
            <span className="opacity-50">
              @ 0x{block.base_address.toString(16).toUpperCase()}
            </span>
          </div>
          {isExpanded && (
            <div>
              {regsAny.map((node, idx) => {
                if (isArrayNode(node)) {
                  return renderArrayRegister(node, block, blockIndex, idx);
                }
                return renderLeafRegister(node as Register, blockIndex, idx);
              })}
              {(block as any).register_arrays?.map(
                (arr: RegisterArray, idx: number) =>
                  renderArray(arr, blockIndex, idx),
              )}
            </div>
          )}
        </div>
      );
    };

    const rootId = "root";
    const isRootExpanded = expanded.has(rootId);
    const isRootSelected = selectedId === rootId;

    const filteredBlocks = useMemo(() => {
      const q = query.trim().toLowerCase();
      const blocks = (memoryMap.address_blocks ?? []).map((block, index) => ({
        block,
        index,
      }));
      if (!q) {
        return blocks;
      }

      return blocks.filter(({ block }) => {
        if ((block.name ?? "").toLowerCase().includes(q)) {
          return true;
        }
        const regs = ((block as any).registers ?? []) as any[];
        if (
          regs.some((r) => {
            if (!r) {
              return false;
            }
            if (
              String(r.name ?? "")
                .toLowerCase()
                .includes(q)
            ) {
              return true;
            }
            if (isArrayNode(r)) {
              return (r.registers ?? []).some((rr) =>
                String(rr.name ?? "")
                  .toLowerCase()
                  .includes(q),
              );
            }
            return false;
          })
        ) {
          return true;
        }
        const arrays = ((block as any).register_arrays ?? []) as any[];
        if (arrays.some((a) => (a.name ?? "").toLowerCase().includes(q))) {
          return true;
        }
        return false;
      });
    }, [memoryMap, query]);

    const visibleSelections = useMemo(() => {
      const items: Array<
        OutlineProps["onSelect"] extends (arg: infer A) => any ? A : never
      > = [];

      // Root
      items.push({
        id: rootId,
        type: "memoryMap",
        object: memoryMap,
        breadcrumbs: [memoryMap.name || "Memory Map"],
        path: [],
      });

      if (!expanded.has(rootId)) {
        return items;
      }

      filteredBlocks.forEach(({ block, index: blockIndex }) => {
        const blockId = `block-${blockIndex}`;
        items.push({
          id: blockId,
          type: "block",
          object: block,
          breadcrumbs: [memoryMap.name || "Memory Map", block.name],
          path: ["addressBlocks", blockIndex],
        });

        if (!expanded.has(blockId)) {
          return;
        }

        const regsAny = ((block as any).registers ?? []) as any[];
        regsAny.forEach((node: any, regIndex: number) => {
          if (isArrayNode(node)) {
            const arr = node;
            const arrId = `block-${blockIndex}-arrreg-${regIndex}`;
            items.push({
              id: arrId,
              type: "array",
              object: arr,
              breadcrumbs: [
                memoryMap.name || "Memory Map",
                block.name,
                arr.name,
              ],
              path: ["addressBlocks", blockIndex, "registers", regIndex],
            });

            if (!expanded.has(arrId)) {
              return;
            }

            const start = (block.base_address ?? 0) + (arr.address_offset ?? 0);
            Array.from({ length: arr.count }).forEach((_, elementIndex) => {
              const elementId = `${arrId}-el-${elementIndex}`;
              const elementBase = start + elementIndex * arr.stride;
              items.push({
                id: elementId,
                type: "array",
                object: {
                  ...arr,
                  __element_index: elementIndex,
                  __element_base: elementBase,
                },
                breadcrumbs: [
                  memoryMap.name || "Memory Map",
                  block.name,
                  `${arr.name}[${elementIndex}]`,
                ],
                path: ["addressBlocks", blockIndex, "registers", regIndex],
              });

              (arr.registers ?? []).forEach(
                (reg: Register, childIndex: number) => {
                  const childId = `${elementId}-reg-${childIndex}`;
                  const absolute = elementBase + (reg.address_offset ?? 0);
                  items.push({
                    id: childId,
                    type: "register",
                    object: reg,
                    breadcrumbs: [
                      memoryMap.name || "Memory Map",
                      block.name,
                      `${arr.name}[${elementIndex}]`,
                      reg.name,
                    ],
                    path: [
                      "addressBlocks",
                      blockIndex,
                      "registers",
                      regIndex,
                      "registers",
                      childIndex,
                    ],
                    meta: {
                      absoluteAddress: absolute,
                      relativeOffset: reg.address_offset ?? 0,
                    },
                  });
                },
              );
            });
            return;
          }

          const reg = node as Register;
          const regId = `block-${blockIndex}-reg-${regIndex}`;
          const absolute =
            (block.base_address ?? 0) + (reg.address_offset ?? 0);
          items.push({
            id: regId,
            type: "register",
            object: reg,
            breadcrumbs: [
              memoryMap.name || "Memory Map",
              memoryMap.address_blocks?.[blockIndex]?.name ?? "",
              reg.name,
            ],
            path: ["addressBlocks", blockIndex, "registers", regIndex],
            meta: {
              absoluteAddress: absolute,
              relativeOffset: reg.address_offset ?? 0,
            },
          });
        });

        ((block as any).register_arrays ?? []).forEach(
          (arr: any, arrayIndex: number) => {
            const arrId = `block-${blockIndex}-arr-${arrayIndex}`;
            items.push({
              id: arrId,
              type: "array",
              object: arr,
              breadcrumbs: [
                memoryMap.name || "Memory Map",
                memoryMap.address_blocks?.[blockIndex]?.name ?? "",
                arr.name,
              ],
              path: [
                "addressBlocks",
                blockIndex,
                "register_arrays",
                arrayIndex,
              ],
            });

            if (!expanded.has(arrId)) {
              return;
            }
            if (!Array.isArray(arr.children_registers)) {
              return;
            }
            arr.children_registers.forEach(
              (reg: Register, regIndex: number) => {
                // Matches existing render behavior (renderLeafRegister)
                const regId = `block-${blockIndex}-reg-${regIndex}`;
                const absolute =
                  (block.base_address ?? 0) + (reg.address_offset ?? 0);
                items.push({
                  id: regId,
                  type: "register",
                  object: reg,
                  breadcrumbs: [
                    memoryMap.name || "Memory Map",
                    memoryMap.address_blocks?.[blockIndex]?.name ?? "",
                    reg.name,
                  ],
                  path: ["addressBlocks", blockIndex, "registers", regIndex],
                  meta: {
                    absoluteAddress: absolute,
                    relativeOffset: reg.address_offset ?? 0,
                  },
                });
              },
            );
          },
        );
      });

      return items;
    }, [memoryMap, expanded, filteredBlocks]);

    const onTreeKeyDown = (e: React.KeyboardEvent) => {
      // If currently editing, don't handle tree navigation
      if (editingId) return;

      const keyLower = (e.key || "").toLowerCase();
      const isDown = e.key === "ArrowDown" || keyLower === "j";
      const isUp = e.key === "ArrowUp" || keyLower === "k";
      const isToggleExpand =
        e.key === " " || (e.key === "Enter" && !e.shiftKey);
      const isFocusDetails =
        (e.key === "Enter" && !isToggleExpand) ||
        e.key === "ArrowRight" ||
        keyLower === "l";
      const isRename = e.key === "F2" || keyLower === "e";

      if (!isDown && !isUp && !isFocusDetails && !isToggleExpand && !isRename) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const currentId = selectedId ?? rootId;
      const currentIndex = Math.max(
        0,
        visibleSelections.findIndex((s) => s.id === currentId),
      );
      const currentSel =
        visibleSelections[currentIndex] ?? visibleSelections[0];
      if (!currentSel) {
        return;
      }

      // Handle F2 or 'e' to start renaming
      if (isRename && onRename) {
        e.preventDefault();
        e.stopPropagation();
        const name = currentSel.object?.name ?? "";
        if (name) {
          startEditing(currentId, name);
        }
        return;
      }

      // Handle Space or Enter to toggle expand/collapse
      if (isToggleExpand) {
        e.preventDefault();
        e.stopPropagation();

        // Check if current node has children
        const hasChildren = (() => {
          if (currentId === rootId) {
            return true; // Root always has blocks
          }
          if (currentId.startsWith("block-") && !currentId.includes("-reg-")) {
            const blockIdx = parseInt(currentId.split("-")[1], 10);
            const block = memoryMap.address_blocks?.[blockIdx];
            return (
              block &&
              Array.isArray(block.registers) &&
              block.registers.length > 0
            );
          }
          if (
            currentId.includes("-reg-") &&
            currentId.split("-reg-")[1].includes("-")
          ) {
            // This is a register array
            const parts = currentId.split("-");
            const blockIdx = parseInt(parts[1], 10);
            const regIdx = parseInt(parts[3], 10);
            const block = memoryMap.address_blocks?.[blockIdx];
            const reg = block?.registers?.[regIdx] as any;
            return reg && (reg.count ?? 0) > 1;
          }
          return false;
        })();

        if (hasChildren) {
          const newExpanded = new Set(expanded);
          if (newExpanded.has(currentId)) {
            newExpanded.delete(currentId);
          } else {
            newExpanded.add(currentId);
          }
          setExpanded(newExpanded);
        }
        return;
      }

      if (isFocusDetails) {
        e.preventDefault();
        e.stopPropagation();
        onSelect({
          ...currentSel,
          meta: { ...(currentSel.meta ?? {}), focusDetails: true },
        });
        return;
      }

      const nextIndex = isDown
        ? Math.min(visibleSelections.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
      const nextSel = visibleSelections[nextIndex];
      if (!nextSel) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onSelect({
        ...nextSel,
        meta: { ...(nextSel.meta ?? {}), focusDetails: false },
      });
    };

    return (
      <>
        <div className="p-3 border-b vscode-border vscode-surface flex items-center gap-2">
          <div className="relative flex-1">
            <span className="codicon codicon-search absolute left-2.5 top-2 vscode-muted text-[18px]"></span>
            <input
              className="outline-filter-input w-full pl-9 pr-3 py-1.5 text-sm rounded-md outline-none"
              placeholder="Filter registers..."
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button
            className="outline-filter-button ml-2 p-2 rounded flex items-center justify-center"
            title={
              expanded.size === allIds.size ? "Collapse All" : "Expand All"
            }
            onClick={() => {
              if (expanded.size === allIds.size) {
                setExpanded(new Set(["root"]));
              } else {
                setExpanded(new Set(allIds));
              }
            }}
          >
            {expanded.size === allIds.size ? (
              // Collapse All SVG icon
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="3"
                  y="3"
                  width="14"
                  height="14"
                  rx="3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <rect
                  x="6"
                  y="9"
                  width="8"
                  height="2"
                  rx="1"
                  fill="currentColor"
                />
              </svg>
            ) : (
              // Expand All SVG icon
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="3"
                  y="3"
                  width="14"
                  height="14"
                  rx="3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <rect
                  x="6"
                  y="9"
                  width="8"
                  height="2"
                  rx="1"
                  fill="currentColor"
                />
                <rect
                  x="9"
                  y="6"
                  width="2"
                  height="8"
                  rx="1"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-3 mb-2 text-xs font-bold vscode-muted uppercase tracking-wider">
            Memory Map
          </div>
          <div
            ref={treeFocusRef}
            tabIndex={0}
            onKeyDown={onTreeKeyDown}
            className="outline-none focus:outline-none"
          >
            <div
              className={`tree-item ${isRootSelected ? "selected" : ""} gap-2 text-sm`}
              onClick={() => {
                treeFocusRef.current?.focus();
                onSelect({
                  id: rootId,
                  type: "memoryMap",
                  object: memoryMap,
                  breadcrumbs: [memoryMap.name || "Memory Map"],
                  path: [],
                });
              }}
            >
              <span
                className={`codicon codicon-chevron-${isRootExpanded ? "down" : "right"} text-[16px] ${isRootSelected ? "" : "opacity-70"}`}
                onClick={(e) => toggleExpand(rootId, e)}
              ></span>
              <span
                className={`codicon codicon-map text-[16px] ${isRootSelected ? "" : "opacity-70"}`}
              ></span>
              {renderNameOrEdit(
                rootId,
                memoryMap.name || "Memory Map",
                [],
                "flex-1",
              )}
            </div>
            {isRootExpanded &&
              filteredBlocks.map(({ block, index }) =>
                renderBlock(block, index),
              )}
          </div>
        </div>
        <div className="outline-footer p-3 text-xs vscode-muted flex justify-between">
          <span>{filteredBlocks.length} Items</span>
          <span>
            Base: {toHex(memoryMap.address_blocks?.[0]?.base_address ?? 0)}
          </span>
        </div>
      </>
    );
  },
);

export default Outline;
