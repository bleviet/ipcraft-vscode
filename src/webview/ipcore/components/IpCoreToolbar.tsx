import React, { useEffect, useRef, useState } from 'react';
import { vscode } from '../../vscode';

// ---------------------------------------------------------------------------
// Toolbar primitives — extracted from IpCoreApp (issue #129) so IpCoreApp is
// primarily composition/orchestration rather than toolbar presentation.
// ---------------------------------------------------------------------------

interface ToolbarButtonProps {
  title: string;
  icon: string;
  command?: string;
  disabled?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  title,
  icon,
  command,
  disabled,
  onClick,
  onContextMenu,
}) => (
  <button
    className="canvas-view-toggle"
    title={title}
    type="button"
    disabled={disabled}
    onClick={onClick ?? (() => command && vscode?.postMessage({ type: 'command', command }))}
    onContextMenu={onContextMenu}
    aria-label={title}
    style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
  >
    <span className={`codicon codicon-${icon}`} />
  </button>
);

interface HdlLanguagePickerProps {
  value: 'vhdl' | 'systemverilog';
}

const HdlLanguagePicker: React.FC<HdlLanguagePickerProps> = ({ value }) => {
  const set = (lang: 'vhdl' | 'systemverilog') =>
    vscode?.postMessage({ type: 'setHdlLanguage', language: lang });

  const pillStyle = (lang: 'vhdl' | 'systemverilog'): React.CSSProperties => {
    const active = value === lang;
    return {
      fontSize: '9px',
      fontWeight: 600,
      letterSpacing: '0.04em',
      lineHeight: 1,
      padding: '2px 4px',
      borderRadius: 3,
      border: 'none',
      cursor: active ? 'default' : 'pointer',
      userSelect: 'none',
      background: active
        ? lang === 'vhdl'
          ? 'rgba(224, 150, 50, 0.20)'
          : 'rgba(60, 150, 220, 0.20)'
        : 'transparent',
      color: active
        ? lang === 'vhdl'
          ? '#e09632'
          : '#3c96dc'
        : 'var(--vscode-descriptionForeground)',
      opacity: active ? 1 : 0.5,
    };
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}
      title={
        value === 'vhdl' ? 'Click .SV to switch to SystemVerilog' : 'Click .VHD to switch to VHDL'
      }
    >
      <button
        style={pillStyle('vhdl')}
        onClick={() => set('vhdl')}
        type="button"
        aria-label="Use VHDL"
      >
        .VHD
      </button>
      <button
        style={pillStyle('systemverilog')}
        onClick={() => set('systemverilog')}
        type="button"
        aria-label="Use SystemVerilog"
      >
        .SV
      </button>
    </div>
  );
};

export interface PackSummary {
  /** Directory name — used as the value in scaffold_pack: */
  id: string;
  /** Human-readable label derived from the id */
  label: string;
  /** Short description from scaffold.yml */
  description: string;
  /** 'builtin' | 'example' | 'workspace' */
  category: string;
}

interface ScaffoldPackPickerProps {
  selected: string; // pack id, e.g. "builtin-minimal"
  packs: PackSummary[];
}

const ScaffoldPackPicker: React.FC<ScaffoldPackPickerProps> = ({ selected, packs }) => {
  const groups: Record<string, PackSummary[]> = {};
  for (const p of packs) {
    const g = p.category || 'other';
    (groups[g] ??= []).push(p);
  }
  const groupOrder = ['builtin', 'example', 'workspace', 'other'];

  return (
    <select
      value={selected}
      onChange={(e) => vscode?.postMessage({ type: 'setScaffoldPack', packName: e.target.value })}
      aria-label="Scaffold pack"
      style={{
        background: 'var(--vscode-dropdown-background)',
        color: 'var(--vscode-dropdown-foreground)',
        border: '1px solid var(--vscode-dropdown-border)',
        borderRadius: 2,
        fontSize: '11px',
        padding: '2px 4px',
        cursor: 'pointer',
        outline: 'none',
        maxWidth: 180,
      }}
    >
      {groupOrder
        .filter((g) => groups[g]?.length)
        .map((g) => (
          <optgroup key={g} label={g.charAt(0).toUpperCase() + g.slice(1)}>
            {groups[g].map((p) => (
              <option key={p.id} value={p.id} title={p.description}>
                {p.label}
              </option>
            ))}
          </optgroup>
        ))}
    </select>
  );
};

/**
 * Multi-select toolbar target picker. Each pill toggles a toolchain id in/out
 * of the active set. The set is persisted to ipcraft.toolbar.targets.
 */

/** Well-known per-vendor display metadata. Unknown vendors fall back to defaults. */
const VENDOR_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  quartus: { label: 'ALTERA', bg: 'rgba(0, 113, 197, 0.20)', fg: '#0071c5' },
  vivado: { label: 'XILINX', bg: 'rgba(230, 0, 0, 0.20)', fg: '#e60000' },
};

const FALLBACK_STYLE = { bg: 'rgba(80, 200, 120, 0.20)', fg: '#3aaa5c' };

export interface RegisteredToolchain {
  id: string;
  displayName: string;
}

interface TargetVendorPickerProps {
  value: string[];
  availableToolchains: RegisteredToolchain[];
}

const TargetVendorPicker: React.FC<TargetVendorPickerProps> = ({ value, availableToolchains }) => {
  const setTargets = (next: string[]) =>
    vscode?.postMessage({ type: 'setToolbarTargets', targets: next });

  const toggle = (id: string) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    setTargets(next);
  };

  const pillStyle = (id: string): React.CSSProperties => {
    const active = value.includes(id);
    const style = VENDOR_STYLE[id] ?? FALLBACK_STYLE;
    return {
      fontSize: '9px',
      fontWeight: 600,
      letterSpacing: '0.04em',
      lineHeight: 1,
      padding: '2px 4px',
      borderRadius: 3,
      border: 'none',
      cursor: 'pointer',
      userSelect: 'none',
      background: active ? style.bg : 'transparent',
      color: active ? style.fg : 'var(--vscode-descriptionForeground)',
      opacity: active ? 1 : 0.5,
    };
  };

  const labelFor = (tc: RegisteredToolchain): string => {
    const known = VENDOR_STYLE[tc.id];
    if (known) {
      return known.label;
    }
    return tc.displayName.split(/[\s(]/)[0].toUpperCase();
  };

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}
      title="Toggle which vendor toolchain sections show in the toolbar"
    >
      {availableToolchains.map((tc) => (
        <button
          key={tc.id}
          style={pillStyle(tc.id)}
          onClick={() => toggle(tc.id)}
          type="button"
          aria-label={`Toggle ${labelFor(tc)} tools`}
        >
          {labelFor(tc)}
        </button>
      ))}
    </div>
  );
};

type VendorDropdownItem =
  | { separator: true }
  | { icon: string; label: string; disabled?: boolean; command?: string; onClick?: () => void };

interface VendorDropdownProps {
  vendorId: string;
  items: VendorDropdownItem[];
}

const VendorDropdown: React.FC<VendorDropdownProps> = ({ vendorId, items }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handle = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !btnRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const style = VENDOR_STYLE[vendorId] ?? FALLBACK_STYLE;
  const rect = btnRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={btnRef}
        className="canvas-view-toggle"
        onClick={() => setOpen((o) => !o)}
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        title={`${VENDOR_STYLE[vendorId]?.label ?? vendorId.toUpperCase()} toolchain actions`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          fontSize: '9px',
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: style.fg,
          background: open ? style.bg : undefined,
        }}
      >
        {VENDOR_STYLE[vendorId]?.label ?? vendorId.toUpperCase()}
        <span
          className="codicon codicon-chevron-down"
          style={{ fontSize: 8, opacity: 0.7, marginTop: 1 }}
        />
      </button>
      {open && rect && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: rect.bottom + 4,
            right: window.innerWidth - rect.right,
            zIndex: 200,
            minWidth: 256,
            background: 'var(--vscode-menu-background, var(--vscode-editorWidget-background))',
            border: '1px solid var(--vscode-menu-border, var(--vscode-panel-border))',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            padding: '4px 0',
          }}
        >
          {items.map((item, i) => {
            if ('separator' in item) {
              return (
                <div
                  key={i}
                  style={{
                    height: 1,
                    background:
                      'var(--vscode-menu-separatorBackground, var(--vscode-panel-border))',
                    margin: '4px 0',
                  }}
                />
              );
            }
            return (
              <button
                key={i}
                type="button"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  if (item.onClick) {
                    item.onClick();
                  } else if (item.command) {
                    vscode?.postMessage({ type: 'command', command: item.command });
                  }
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      'var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground))';
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '4px 12px',
                  background: 'transparent',
                  border: 'none',
                  color: item.disabled
                    ? 'var(--vscode-disabledForeground)'
                    : 'var(--vscode-menu-foreground, var(--vscode-foreground))',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  textAlign: 'left',
                  opacity: item.disabled ? 0.5 : 1,
                }}
              >
                <span
                  className={`codicon codicon-${item.icon}`}
                  style={{ width: 14, fontSize: 12, flexShrink: 0 }}
                />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
};

interface ToolbarGroupProps {
  label: string;
  children: React.ReactNode;
}

const ToolbarGroup: React.FC<ToolbarGroupProps> = ({ label, children }) => (
  <div className="flex flex-col items-center gap-0.5">
    {/* Fixed-height icon row so every group's label lands on the same baseline */}
    <div className="flex items-center gap-0.5" style={{ height: 28 }}>
      {children}
    </div>
    <span
      style={{
        fontSize: '9px',
        opacity: 0.45,
        letterSpacing: '0.03em',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {label}
    </span>
  </div>
);

const ToolbarSeparator: React.FC = () => (
  <div
    style={{
      width: '1px',
      height: '28px',
      background: 'var(--vscode-panel-border)',
      opacity: 0.6,
    }}
  />
);

// ---------------------------------------------------------------------------
// Composite toolbar
// ---------------------------------------------------------------------------

export interface ConsistencyBadge {
  label: string;
  color: string;
  title: string;
}

export interface IpCoreToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  toolbarTargets: string[];
  allToolchains: RegisteredToolchain[];
  hdlLanguage: 'vhdl' | 'systemverilog';
  scaffoldPack: string;
  availableScaffoldPacks: PackSummary[];
  hasHwTcl: boolean;
  hasQpf: boolean;
  hasComponentXml: boolean;
  hasXpr: boolean;
  consistencyChecking: boolean;
  hasConsistencyResult: boolean;
  consistencyBadge: ConsistencyBadge;
  onCheckConsistency: () => void;
  onToggleConsistencyOverlay: () => void;
  validationErrorCount: number;
}

/**
 * The IP Core editor's header toolbar: undo/redo, target vendor/HDL language,
 * scaffold pack, generate actions, vendor-specific integration menus, the
 * consistency-check badge, and utility buttons. Extracted from IpCoreApp
 * (issue #129) so IpCoreApp itself is primarily composition/orchestration.
 */
export const IpCoreToolbar: React.FC<IpCoreToolbarProps> = ({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  toolbarTargets,
  allToolchains,
  hdlLanguage,
  scaffoldPack,
  availableScaffoldPacks,
  hasHwTcl,
  hasQpf,
  hasComponentXml,
  hasXpr,
  consistencyChecking,
  hasConsistencyResult,
  consistencyBadge,
  onCheckConsistency,
  onToggleConsistencyOverlay,
  validationErrorCount,
}) => (
  <div className="flex items-start gap-2">
    {/* Zone 1: History */}
    <ToolbarGroup label="History">
      <button
        className="canvas-view-toggle"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
        type="button"
        style={{
          opacity: !canUndo ? 0.4 : 1,
          cursor: !canUndo ? 'not-allowed' : 'pointer',
        }}
      >
        <span className="codicon codicon-discard"></span>
      </button>
      <button
        className="canvas-view-toggle"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
        type="button"
        style={{
          opacity: !canRedo ? 0.4 : 1,
          cursor: !canRedo ? 'not-allowed' : 'pointer',
        }}
      >
        <span className="codicon codicon-redo"></span>
      </button>
    </ToolbarGroup>

    {/* Zone 2: Context toggles — gating controls sit left of what they gate */}
    <ToolbarSeparator />
    <ToolbarGroup label="Target">
      <TargetVendorPicker value={toolbarTargets} availableToolchains={allToolchains} />
      <HdlLanguagePicker value={hdlLanguage} />
    </ToolbarGroup>

    {/* Zone 3: Scaffold pack manifest */}
    <ToolbarSeparator />
    <ToolbarGroup label="Scaffold Template">
      <ScaffoldPackPicker selected={scaffoldPack} packs={availableScaffoldPacks} />
    </ToolbarGroup>

    {/* Zone 4: Core generate actions */}
    <ToolbarSeparator />
    <ToolbarGroup label="Generate">
      <ToolbarButton
        title="Scaffold Project (RTL + EDA packaging + Testbench)"
        icon="package"
        command="fpga-ip-core.scaffoldProject"
      />
      <ToolbarButton
        title="Create Register Map"
        icon="map"
        command="fpga-ip-core.createMemoryMap"
      />
      <ToolbarButton
        title={`Generate Top-Level ${hdlLanguage === 'systemverilog' ? 'SystemVerilog' : 'VHDL'}`}
        icon="code"
        command="fpga-ip-core.generateHdl"
      />
      <ToolbarButton
        title="Generate CocoTB Testbench"
        icon="beaker"
        command="fpga-ip-core.generateTestbench"
      />
      <ToolbarButton
        title="Generate Documentation"
        icon="book"
        command="fpga-ip-core.generateDocumentation"
      />
    </ToolbarGroup>

    {/* Zone 5: Single Integration group — stable width via visibility, not conditional rendering */}
    {(toolbarTargets.includes('quartus') || toolbarTargets.includes('vivado')) && (
      <>
        <ToolbarSeparator />
        <ToolbarGroup label="Integration">
          <div
            style={{
              visibility: toolbarTargets.includes('quartus') ? 'visible' : 'hidden',
            }}
          >
            <VendorDropdown
              vendorId="quartus"
              items={[
                {
                  icon: 'layers',
                  label: 'Generate Platform Designer _hw.tcl',
                  command: 'fpga-ip-core.exportAltera',
                },
                {
                  icon: 'edit',
                  label: 'Open in Platform Designer',
                  disabled: !hasHwTcl,
                  onClick: () => vscode?.postMessage({ type: 'editInPlatformDesigner' }),
                },
                { separator: true },
                {
                  icon: 'circuit-board',
                  label: 'Generate Quartus Project',
                  command: 'fpga-ip-core.generateQuartusProject',
                },
                {
                  icon: 'folder-opened',
                  label: 'Open Project in Quartus',
                  disabled: !hasQpf,
                  onClick: () => vscode?.postMessage({ type: 'openInQuartus' }),
                },
                {
                  icon: 'tools',
                  label: 'Build: Quartus full compile',
                  disabled: !hasQpf,
                  command: 'fpga-ip-core.buildQuartusCompile',
                },
              ]}
            />
          </div>
          <div
            style={{
              visibility: toolbarTargets.includes('vivado') ? 'visible' : 'hidden',
            }}
          >
            <VendorDropdown
              vendorId="vivado"
              items={[
                {
                  icon: 'layers',
                  label: 'Generate Vivado Component XML',
                  command: 'fpga-ip-core.exportXilinx',
                },
                {
                  icon: 'edit',
                  label: 'Edit in IP Packager',
                  disabled: !hasComponentXml,
                  onClick: () => vscode?.postMessage({ type: 'editInIpPackager' }),
                },
                { separator: true },
                {
                  icon: 'circuit-board',
                  label: 'Generate Vivado Project',
                  command: 'fpga-ip-core.generateVivadoProject',
                },
                {
                  icon: 'folder-opened',
                  label: 'Open Project in Vivado',
                  disabled: !hasXpr,
                  onClick: () => vscode?.postMessage({ type: 'openInVivado' }),
                },
                {
                  icon: 'tools',
                  label: 'Build: Vivado OOC synthesis',
                  disabled: !hasXpr,
                  command: 'fpga-ip-core.buildVivadoOoc',
                },
              ]}
            />
          </div>
        </ToolbarGroup>
      </>
    )}

    {/* Zone 5b: Consistency check (issue #84) */}
    <ToolbarSeparator />
    <ToolbarGroup label="Consistency">
      <ToolbarButton
        title="Check Consistency (HDL + vendor artifacts vs. this .ip.yml)"
        icon="verified"
        onClick={onCheckConsistency}
        disabled={consistencyChecking}
      />
      <button
        type="button"
        className="canvas-view-toggle"
        onClick={() => hasConsistencyResult && onToggleConsistencyOverlay()}
        title={consistencyBadge.title}
        aria-label={`Consistency status: ${consistencyBadge.label}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: '9px',
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: consistencyBadge.color,
          cursor: hasConsistencyResult ? 'pointer' : 'default',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: consistencyBadge.color,
            flexShrink: 0,
          }}
        />
        {consistencyBadge.label}
      </button>
    </ToolbarGroup>

    {/* Zone 6: Utilities */}
    <ToolbarSeparator />
    <ToolbarGroup label="Utilities">
      <ToolbarButton
        title="Get Started with Scaffold Packs"
        icon="mortar-board"
        onClick={() => vscode?.postMessage({ type: 'openWalkthroughMenu' })}
      />
      <ToolbarButton title="IPCraft Settings" icon="gear" command="fpga-ip-core.openSettings" />
      <ToolbarButton
        title="Report Issue / Send Feedback"
        icon="feedback"
        command="fpga-ip-core.reportIssue"
      />
    </ToolbarGroup>
    {validationErrorCount > 0 && (
      <div className="text-sm" style={{ color: 'var(--vscode-errorForeground)' }}>
        {validationErrorCount} validation error(s)
      </div>
    )}
  </div>
);
