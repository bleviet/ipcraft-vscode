import React, { useEffect, RefObject, useCallback } from "react";
import { Section } from "../../hooks/useNavigation";

interface NavigationSidebarProps {
  selectedSection: Section;
  onNavigate: (section: Section) => void;
  ipCore: any;
  isFocused?: boolean;
  onFocus?: () => void;
  panelRef?: RefObject<HTMLDivElement>;
  className?: string;
}

interface SectionItem {
  id: Section;
  label: string;
  icon?: string;
  customIcon?: React.ReactNode;
  count?: (ipCore: any) => number;
}

// Custom square wave icon for clocks (single pulse pattern)
const SquareWaveIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <path
      d="M1 12 L1 4 L5 4 L5 12 L9 12 L9 4 L13 4 L13 12 L15 12"
      stroke="currentColor"
      strokeWidth="1.2"
      fill="none"
      strokeLinecap="square"
    />
  </svg>
);

const SECTIONS: SectionItem[] = [
  { id: "metadata", label: "Metadata", icon: "info" },
  {
    id: "clocks",
    label: "Clocks",
    customIcon: <SquareWaveIcon />,
    count: (ip) => ip?.clocks?.length || 0,
  },
  {
    id: "resets",
    label: "Resets",
    icon: "debug-restart",
    count: (ip) => ip?.resets?.length || 0,
  },
  {
    id: "ports",
    label: "Ports",
    icon: "plug",
    count: (ip) => ip?.ports?.length || 0,
  },
  {
    id: "busInterfaces",
    label: "Bus Interfaces",
    icon: "circuit-board",
    count: (ip) => ip?.busInterfaces?.length || 0,
  },
  {
    id: "memoryMaps",
    label: "Memory Maps",
    icon: "circuit-board",
    count: (ip) =>
      ip?.memoryMaps?.length || ip?.imports?.memoryMaps?.length || 0,
  },
  {
    id: "parameters",
    label: "Parameters",
    icon: "symbol-parameter",
    count: (ip) => ip?.parameters?.length || 0,
  },
  {
    id: "fileSets",
    label: "File Sets",
    icon: "files",
    count: (ip) => ip?.fileSets?.length || 0,
  },
  // Separator - Generate is an action, not a data section
  { id: "generate", label: "Generate HDL", icon: "tools" },
];

/**
 * Navigation sidebar for IP Core sections
 * Supports vim-style navigation: j/k for up/down, Enter to select
 */
export const NavigationSidebar: React.FC<NavigationSidebarProps> = ({
  selectedSection,
  onNavigate,
  ipCore,
  isFocused = false,
  onFocus,
  panelRef,
  className = '',
}) => {
  // Get the current section index
  const getCurrentIndex = useCallback(() => {
    return SECTIONS.findIndex((s) => s.id === selectedSection);
  }, [selectedSection]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isFocused || !panelRef?.current) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const currentIdx = getCurrentIndex();

      // j or ArrowDown: Move to next section
      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const nextIdx = Math.min(currentIdx + 1, SECTIONS.length - 1);
        onNavigate(SECTIONS[nextIdx].id);
      }
      // k or ArrowUp: Move to previous section
      else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prevIdx = Math.max(currentIdx - 1, 0);
        onNavigate(SECTIONS[prevIdx].id);
      }
      // g: Go to first section
      else if (key === "g") {
        e.preventDefault();
        onNavigate(SECTIONS[0].id);
      }
      // G (Shift+g): Go to last section
      else if (e.key === "G" && e.shiftKey) {
        e.preventDefault();
        onNavigate(SECTIONS[SECTIONS.length - 1].id);
      }
    };

    const panel = panelRef.current;
    panel.addEventListener("keydown", handleKeyDown);
    return () => panel.removeEventListener("keydown", handleKeyDown);
  }, [isFocused, getCurrentIndex, onNavigate, panelRef]);

  return (
    <div
      ref={panelRef}
      tabIndex={0}
      onClick={onFocus}
      className={`w-64 flex flex-col shrink-0 overflow-y-auto outline-none sidebar ${className}`}
      style={{
        background: "var(--vscode-sideBar-background)",
        borderRight: "1px solid var(--vscode-panel-border)",
        outline: isFocused ? "1px solid var(--vscode-focusBorder)" : "none",
        outlineOffset: "-1px",
        opacity: isFocused ? 1 : 0.7,
        transition: "opacity 0.2s",
        color: "var(--vscode-sideBar-foreground)",
      }}
    >
      <nav className="flex-1 overflow-y-auto py-2">
        {SECTIONS.map((section) => {
          const isActive = selectedSection === section.id;
          const count = section.count ? section.count(ipCore) : undefined;

          return (
            <button
              key={section.id}
              onClick={() => onNavigate(section.id)}
              className="w-full px-4 py-2 text-left flex items-center justify-between transition-colors outline-none"
              style={{
                background: isActive
                  ? "var(--vscode-list-activeSelectionBackground)"
                  : "transparent",
                color: isActive
                  ? "var(--vscode-list-activeSelectionForeground)"
                  : "inherit",
                borderLeft: isActive
                  ? "4px solid var(--vscode-focusBorder)"
                  : "4px solid transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background =
                    "var(--vscode-list-hoverBackground)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                }
              }}
            >
              <div className="flex items-center gap-2">
                {section.customIcon ? (
                  section.customIcon
                ) : (
                  <span className={`codicon codicon-${section.icon}`} />
                )}
                <span className="text-sm">{section.label}</span>
              </div>
              {count !== undefined && (
                <span
                  className="text-xs px-2 py-1 rounded-full"
                  style={{
                    background: "var(--vscode-badge-background)",
                    color: "var(--vscode-badge-foreground)",
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
