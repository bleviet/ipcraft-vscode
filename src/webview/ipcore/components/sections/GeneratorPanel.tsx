/**
 * GeneratorPanel - VHDL Code Generation UI
 *
 * Provides interface for generating VHDL files, vendor integration files,
 * and testbenches from IP Core definitions.
 */

import React, {
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";
import { IpCore, BusInterface } from "../../../types/ipCore";
import { vscode } from "../../../vscode";

interface GeneratorPanelProps {
  ipCore: IpCore;
}

type BusType = "axil" | "avmm";
type VendorType = "none" | "intel" | "xilinx" | "both";

interface GenerationOptions {
  busType: BusType;
  includeVhdl: boolean;
  includeRegfile: boolean;
  vendorFiles: VendorType;
  includeTestbench: boolean;
}

interface GenerationStatus {
  status: "idle" | "generating" | "success" | "error";
  message?: string;
  files?: string[];
}

interface DetectedBusInfo {
  busInterface: BusInterface;
  busType: BusType;
  memoryMapRef: string;
}

/**
 * Map bus interface type to generator bus type
 */
function mapBusType(interfaceType: string): BusType | null {
  if (!interfaceType) {
    return null;
  }
  const type = interfaceType.toLowerCase();

  // Check Avalon first (prioritize specific matches)
  if (
    type.includes("avalon") ||
    type === "avmm" ||
    type.includes("avalon-mm")
  ) {
    return "avmm";
  }

  // Check AXI
  if (type.includes("axi") || type === "axi4l" || type === "axi4lite") {
    return "axil";
  }

  return null;
}

/**
 * Detect bus interface with memory map reference
 */
function detectBusWithMemoryMap(ipCore: IpCore): DetectedBusInfo | null {
  // Runtime data uses camelCase (busInterfaces, memoryMapRef)
  const busInterfaces =
    (ipCore as any).busInterfaces || ipCore.bus_interfaces || [];

  for (const bus of busInterfaces) {
    // Check both camelCase (runtime) and snake_case (type def)
    const memMapRef = bus.memoryMapRef || bus.memory_map_ref;
    if (memMapRef) {
      const busType = mapBusType(bus.type);
      if (busType) {
        return {
          busInterface: bus,
          busType,
          memoryMapRef: memMapRef,
        };
      }
    }
  }

  return null;
}

export const GeneratorPanel: React.FC<GeneratorPanelProps> = ({ ipCore }) => {
  // Auto-detect bus type from memory map reference
  const detectedBus = useMemo(() => detectBusWithMemoryMap(ipCore), [ipCore]);

  // Get IP name for preview
  const ipName = ipCore.vlnv?.name?.toLowerCase() || "ip_core";

  const [options, setOptions] = useState<GenerationOptions>(() => {
    const savedState = vscode.getState();
    return savedState && savedState.generationOptions
      ? savedState.generationOptions
      : {
          busType: detectedBus?.busType || "axil",
          includeVhdl: true,
          includeRegfile: true,
          vendorFiles: "none",
          includeTestbench: false,
        };
  });

  // Persist options state
  useEffect(() => {
    const currentState = vscode.getState() || {};
    vscode.setState({ ...currentState, generationOptions: options });
  }, [options]);

  const [status, setStatus] = useState<GenerationStatus>({ status: "idle" });

  // Responsive layout - detect container width
  const containerRef = useRef<HTMLDivElement>(null);
  const [isWideLayout, setIsWideLayout] = useState(false);

  useEffect(() => {
    const checkWidth = () => {
      if (containerRef.current) {
        setIsWideLayout(containerRef.current.offsetWidth > 700);
      }
    };
    checkWidth();
    const resizeObserver = new ResizeObserver(checkWidth);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    return () => resizeObserver.disconnect();
  }, []);

  const handleGenerate = useCallback(() => {
    setStatus({ status: "generating", message: "Generating files..." });

    // Send message to extension to trigger generation
    vscode.postMessage({
      type: "generate",
      options: {
        busType: detectedBus?.busType || options.busType,
        includeVhdl: options.includeVhdl,
        includeRegfile: options.includeRegfile,
        vendorFiles: options.vendorFiles,
        includeTestbench: options.includeTestbench,
      },
    });
  }, [options, detectedBus]);

  // Listen for generation result messages
  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "generateResult") {
        if (message.success) {
          setStatus({
            status: "success",
            message: `Generated ${message.files?.length || 0} files`,
            files: message.files,
          });
        } else {
          setStatus({
            status: "error",
            message: message.error || "Generation failed",
          });
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const labelStyle: React.CSSProperties = {
    fontSize: "12px",
    fontWeight: 500,
    marginBottom: "4px",
    display: "block",
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: "20px",
    padding: "12px",
    background: "var(--vscode-input-background)",
    borderRadius: "4px",
    border: "1px solid var(--vscode-input-border)",
  };

  const checkboxRowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    marginBottom: "8px",
    fontSize: "12px",
  };

  const infoStyle: React.CSSProperties = {
    fontSize: "11px",
    opacity: 0.8,
    marginTop: "4px",
  };

  return (
    <div ref={containerRef} style={{ padding: "16px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "16px" }}>
        Generate HDL
      </h2>

      <p style={{ fontSize: "12px", opacity: 0.8, marginBottom: "16px" }}>
        Generate VHDL files, vendor integration files, and testbenches for{" "}
        <strong>{ipCore.vlnv?.name}</strong>.
      </p>

      {/* Responsive layout wrapper */}
      <div
        style={{
          display: "flex",
          flexDirection: isWideLayout ? "row" : "column",
          gap: "16px",
        }}
      >
        {/* Left column: Options */}
        <div
          style={{ flex: isWideLayout ? "1 1 50%" : "1 1 auto", minWidth: 0 }}
        >
          {/* Detected Bus Interface Section */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Bus Interface</label>
            {detectedBus ? (
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px 12px",
                    background: "var(--vscode-inputValidation-infoBackground)",
                    borderRadius: "4px",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ fontWeight: 500 }}>
                    {detectedBus.busType === "axil"
                      ? "🔵 AXI-Lite"
                      : "🟢 Avalon-MM"}
                  </span>
                  <span style={{ opacity: 0.7 }}>
                    (detected from {detectedBus.busInterface.name})
                  </span>
                </div>
                <p style={infoStyle}>
                  Memory Map: <code>{detectedBus.memoryMapRef}</code>
                </p>
              </div>
            ) : (
              <div
                style={{
                  padding: "8px 12px",
                  background: "var(--vscode-inputValidation-warningBackground)",
                  borderRadius: "4px",
                  fontSize: "12px",
                }}
              >
                ⚠️ No bus interface with memory map detected. Using default:
                AXI-Lite
              </div>
            )}
          </div>

          {/* VHDL Files Section */}
          <div style={sectionStyle}>
            <label style={labelStyle}>VHDL Files</label>
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={options.includeVhdl}
                onChange={(e) =>
                  setOptions({
                    ...options,
                    includeVhdl: e.target.checked,
                    includeRegfile: e.target.checked,
                  })
                }
              />
              Package, Top, Core, Bus Wrapper, Register Bank
            </label>
          </div>

          {/* Vendor Integration Section */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Vendor Integration</label>
            <select
              value={options.vendorFiles}
              onChange={(e) =>
                setOptions({
                  ...options,
                  vendorFiles: e.target.value as VendorType,
                })
              }
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: "12px",
                background: "var(--vscode-dropdown-background)",
                color: "var(--vscode-dropdown-foreground)",
                border: "1px solid var(--vscode-dropdown-border)",
                borderRadius: "2px",
              }}
            >
              <option value="none">None</option>
              <option value="intel">Intel Platform Designer (_hw.tcl)</option>
              <option value="xilinx">Xilinx Vivado (component.xml)</option>
              <option value="both">Both Intel and Xilinx</option>
            </select>
          </div>

          {/* Testbench Section */}
          <div style={sectionStyle}>
            <label style={labelStyle}>Testbench</label>
            <label style={checkboxRowStyle}>
              <input
                type="checkbox"
                checked={options.includeTestbench}
                onChange={(e) =>
                  setOptions({ ...options, includeTestbench: e.target.checked })
                }
              />
              cocotb Python tests + Makefile (GHDL)
            </label>
          </div>
        </div>

        {/* Right column: Preview */}
        <div
          style={{ flex: isWideLayout ? "1 1 50%" : "1 1 auto", minWidth: 0 }}
        >
          {/* Preview Section */}
          <div
            style={{
              ...sectionStyle,
              background: "var(--vscode-textBlockQuote-background)",
              fontFamily: "monospace",
              fontSize: "11px",
            }}
          >
            <label style={labelStyle}>📁 Preview: Output Structure</label>
            <div style={{ marginTop: "8px", lineHeight: "1.6" }}>
              <div style={{ color: "var(--vscode-textPreformat-foreground)" }}>
                {ipName}/
              </div>
              {options.includeVhdl && (
                <div style={{ paddingLeft: "16px" }}>
                  <div>├── rtl/</div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    ├── {ipName}_pkg.vhd
                  </div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    ├── {ipName}.vhd
                  </div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    ├── {ipName}_core.vhd
                  </div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    ├── {ipName}_{detectedBus?.busType || "axil"}.vhd
                  </div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    └── {ipName}_regs.vhd
                  </div>
                </div>
              )}
              {options.includeTestbench && (
                <div style={{ paddingLeft: "16px" }}>
                  <div>├── tb/</div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    ├── {ipName}_test.py
                  </div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    └── Makefile
                  </div>
                </div>
              )}
              {(options.vendorFiles === "intel" ||
                options.vendorFiles === "both") && (
                <div style={{ paddingLeft: "16px" }}>
                  <div>├── intel/</div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    └── {ipName}_hw.tcl
                  </div>
                </div>
              )}
              {(options.vendorFiles === "xilinx" ||
                options.vendorFiles === "both") && (
                <div style={{ paddingLeft: "16px" }}>
                  <div>└── xilinx/</div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    ├── component.xml
                  </div>
                  <div style={{ paddingLeft: "24px", opacity: 0.8 }}>
                    └── xgui/{ipName}_v*.tcl
                  </div>
                </div>
              )}
            </div>
            <div style={{ marginTop: "8px", fontSize: "10px", opacity: 0.7 }}>
              {(() => {
                let count = 0;
                if (options.includeVhdl) count += 5; // pkg, top, core, bus, regs
                if (options.vendorFiles === "intel") count += 1;
                if (options.vendorFiles === "xilinx") count += 2; // component.xml + xgui
                if (options.vendorFiles === "both") count += 3; // intel hw.tcl + xilinx 2 files
                if (options.includeTestbench) count += 2;
                return `${count} file(s) will be generated`;
              })()}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={status.status === "generating"}
            style={{
              width: "100%",
              padding: "10px 16px",
              fontSize: "13px",
              fontWeight: 500,
              background: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
              border: "none",
              borderRadius: "4px",
              cursor: status.status === "generating" ? "wait" : "pointer",
              opacity: status.status === "generating" ? 0.7 : 1,
            }}
          >
            {status.status === "generating"
              ? "⏳ Generating..."
              : "🔧 Generate Files"}
          </button>

          {/* Status Display */}
          {status.status === "success" && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                background: "var(--vscode-inputValidation-infoBackground)",
                borderRadius: "4px",
                fontSize: "12px",
              }}
            >
              <p style={{ fontWeight: 500, marginBottom: "8px" }}>
                ✅ {status.message}
              </p>
              {status.files && (
                <ul style={{ margin: 0, paddingLeft: "16px" }}>
                  {status.files.map((file, idx) => (
                    <li key={idx}>{file}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {status.status === "error" && (
            <div
              style={{
                marginTop: "16px",
                padding: "12px",
                background: "var(--vscode-inputValidation-errorBackground)",
                border: "1px solid var(--vscode-inputValidation-errorBorder)",
                borderRadius: "4px",
                fontSize: "12px",
                color: "var(--vscode-errorForeground)",
              }}
            >
              ❌ {status.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
