import React, { useCallback, useEffect, useState } from 'react';
import { vscode } from '../vscode';
import { useTemplatePreview } from './useTemplatePreview';
import type { HostMessage, ManifestData, ManifestOutput } from './types';

// ---------------------------------------------------------------------------
// Helpers — simple regex substitution (no eval, CSP-safe)
// ---------------------------------------------------------------------------

// Resolves {{ varName }} and {{ varName | filter... }} by substituting the variable
// value and discarding filter expressions. Safe for CSP: no eval() involved.
function renderExpr(expr: string, context: Record<string, unknown>): string {
  return expr.replace(/\{\{([^}]+)\}\}/g, (match: string, inner: string): string => {
    const varName = (inner.trim().split('|')[0] ?? '').trim();
    const val: unknown = context[varName];
    return val !== undefined ? String(val) : match;
  });
}

function isWhenTrue(when: string | undefined, context: Record<string, unknown>): boolean {
  if (!when) {
    return true;
  }
  const v = renderExpr(when, context).trim().toLowerCase();
  return v !== '' && v !== 'false' && v !== '0' && v !== 'none';
}

// ---------------------------------------------------------------------------
// Shared style tokens
// ---------------------------------------------------------------------------

const BORDER = '1px solid var(--vscode-panel-border)';
const BG_EDITOR = 'var(--vscode-editor-background)';
const FG = 'var(--vscode-editor-foreground)';
const BG_SIDEBAR = 'var(--vscode-sideBar-background)';
const MONO = 'var(--vscode-editor-font-family, "Cascadia Code", monospace)';

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <div
    style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: FG,
      opacity: 0.5,
      padding: '8px 8px 2px',
    }}
  >
    {label}
  </div>
);

// ---------------------------------------------------------------------------
// Flat template tree item (no-manifest mode)
// ---------------------------------------------------------------------------

const TemplateItem: React.FC<{
  name: string;
  isSelected: boolean;
  isCustom: boolean;
  onClick: () => void;
}> = ({ name, isSelected, isCustom, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      width: '100%',
      textAlign: 'left',
      padding: '3px 8px',
      fontSize: 12,
      fontFamily: MONO,
      background: isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
      color: isSelected ? 'var(--vscode-list-activeSelectionForeground)' : FG,
      border: 'none',
      cursor: 'pointer',
      borderRadius: 2,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}
  >
    <span
      className={`codicon codicon-${isCustom ? 'file-code' : 'file'}`}
      style={{ opacity: isCustom ? 1 : 0.5, flexShrink: 0 }}
    />
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
    {isCustom && (
      <span
        style={{
          marginLeft: 'auto',
          fontSize: 10,
          opacity: 0.7,
          background: 'var(--vscode-badge-background)',
          color: 'var(--vscode-badge-foreground)',
          borderRadius: 2,
          padding: '0 4px',
          flexShrink: 0,
        }}
      >
        custom
      </span>
    )}
  </button>
);

// ---------------------------------------------------------------------------
// Manifest output tree item
// ---------------------------------------------------------------------------

const OutputItem: React.FC<{
  output: ManifestOutput;
  renderedPath: string;
  isSelected: boolean;
  isBuiltin: boolean;
  isSkipped: boolean;
  onClick: () => void;
}> = ({ output, renderedPath, isSelected, isBuiltin, isSkipped, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={output.template ?? output.generator ?? ''}
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 5,
      width: '100%',
      textAlign: 'left',
      padding: '2px 8px 2px 20px',
      fontSize: 11,
      fontFamily: MONO,
      background: isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'transparent',
      color: isSelected ? 'var(--vscode-list-activeSelectionForeground)' : FG,
      opacity: isSkipped ? 0.4 : 1,
      border: 'none',
      cursor: 'pointer',
      borderRadius: 2,
      overflow: 'hidden',
    }}
  >
    {isBuiltin && (
      <span
        className="codicon codicon-lock"
        style={{ fontSize: 10, opacity: 0.6, flexShrink: 0 }}
      />
    )}
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{renderedPath}</span>
    {isSkipped && (
      <span style={{ fontSize: 9, opacity: 0.6, flexShrink: 0, fontFamily: 'sans-serif' }}>
        skip
      </span>
    )}
  </button>
);

// ---------------------------------------------------------------------------
// Group header with toggle
// ---------------------------------------------------------------------------

const GroupHeader: React.FC<{
  name: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}> = ({ name, enabled, onToggle }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 8px 2px',
      cursor: 'pointer',
    }}
    onClick={() => onToggle(!enabled)}
  >
    <input
      type="checkbox"
      checked={enabled}
      onChange={(e) => onToggle(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      style={{ margin: 0, cursor: 'pointer' }}
    />
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.05em',
        color: FG,
        opacity: enabled ? 0.85 : 0.45,
        userSelect: 'none',
      }}
    >
      {name}
    </span>
  </div>
);

// ---------------------------------------------------------------------------
// Add output inline form
// ---------------------------------------------------------------------------

interface NewOutputState {
  template: string;
  path: string;
  group: string;
  when: string;
  generator: string;
}

const EMPTY_NEW_OUTPUT: NewOutputState = {
  template: '',
  path: '',
  group: '',
  when: '',
  generator: 'nunjucks',
};

const AddOutputForm: React.FC<{
  groups: string[];
  templates: string[];
  onAdd: (output: ManifestOutput) => void;
  onCancel: () => void;
}> = ({ groups, templates, onAdd, onCancel }) => {
  const [form, setForm] = useState<NewOutputState>(EMPTY_NEW_OUTPUT);

  const set =
    (key: keyof NewOutputState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [key]: e.target.value }));

  const handleSubmit = () => {
    if (!form.path) {
      return;
    }
    const output: ManifestOutput = { path: form.path };
    if (form.generator === 'component-xml') {
      output.generator = 'component-xml';
    } else if (form.template) {
      output.template = form.template;
    }
    if (form.group) {
      output.group = form.group;
    }
    if (form.when) {
      output.when = form.when;
    }
    onAdd(output);
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '3px 5px',
    fontSize: 11,
    fontFamily: MONO,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: 2,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        padding: '8px',
        borderTop: BORDER,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          opacity: 0.5,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
        }}
      >
        Add output
      </span>

      <select value={form.generator} onChange={set('generator')} style={inputStyle}>
        <option value="nunjucks">nunjucks template</option>
        <option value="component-xml">component-xml</option>
      </select>

      {form.generator === 'nunjucks' && (
        <select value={form.template} onChange={set('template')} style={inputStyle}>
          <option value="">— select template —</option>
          {templates.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}

      <input
        type="text"
        placeholder="Output path (e.g. rtl/{{ entity_name }}.vhd)"
        value={form.path}
        onChange={set('path')}
        style={inputStyle}
      />

      <select value={form.group} onChange={set('group')} style={inputStyle}>
        <option value="">— no group —</option>
        {groups.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="when (e.g. {{ has_memory_mapped_slave }})"
        value={form.when}
        onChange={set('when')}
        style={inputStyle}
      />

      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!form.path}
          style={{
            flex: 1,
            padding: '3px 0',
            fontSize: 11,
            background: form.path
              ? 'var(--vscode-button-background)'
              : 'var(--vscode-button-secondaryBackground)',
            color: form.path
              ? 'var(--vscode-button-foreground)'
              : 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: 2,
            cursor: form.path ? 'pointer' : 'not-allowed',
            opacity: form.path ? 1 : 0.5,
          }}
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '3px 0',
            fontSize: 11,
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-secondaryForeground)',
            border: 'none',
            borderRadius: 2,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main app
// ---------------------------------------------------------------------------

export const TemplateEditorApp: React.FC = () => {
  const [builtinTemplates, setBuiltinTemplates] = useState<Record<string, string>>({});
  const [customTemplates, setCustomTemplates] = useState<Record<string, string>>({});
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [context, setContext] = useState<Record<string, unknown>>({});
  const [customTemplateDir, setCustomTemplateDir] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedOutputEntry, setSelectedOutputEntry] = useState<ManifestOutput | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isDirty, setIsDirty] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const isCustom = selectedTemplate !== null && selectedTemplate in customTemplates;
  const isComponentXml = selectedOutputEntry?.generator === 'component-xml';
  const isReadOnly = selectedTemplate !== null && !isCustom && !isComponentXml;

  const { preview, error: previewError } = useTemplatePreview(editContent);

  const flash = useCallback((msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 2500);
  }, []);

  const postSaveManifest = useCallback((updatedManifest: ManifestData) => {
    vscode?.postMessage({
      type: 'saveManifest',
      groups: updatedManifest.groups,
      outputs: updatedManifest.outputs,
    });
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as HostMessage;
      switch (message.type) {
        case 'init':
          setBuiltinTemplates(message.builtinTemplates);
          setCustomTemplates(message.customTemplates);
          setManifest(message.manifest);
          setContext(message.context);
          setCustomTemplateDir(message.customTemplateDir);
          setInitialized(true);
          // Clear selection when manifest changes (e.g. after initManifest)
          setSelectedTemplate(null);
          setSelectedOutputEntry(null);
          setEditContent('');
          setIsDirty(false);
          break;
        case 'copiedBuiltin': {
          const { templateName, content } = message;
          setCustomTemplates((prev) => ({ ...prev, [templateName]: content }));
          setSelectedTemplate(templateName);
          setEditContent(content);
          setIsDirty(false);
          flash(`Copied to custom templates: ${templateName}`);
          break;
        }
        case 'error':
          flash(`Error: ${message.message}`);
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [flash]);

  useEffect(() => {
    vscode?.postMessage({ type: 'ready' });
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const selectTemplate = useCallback(
    (name: string, outputEntry?: ManifestOutput) => {
      setSelectedTemplate(name);
      setSelectedOutputEntry(outputEntry ?? null);
      setEditContent(customTemplates[name] ?? builtinTemplates[name] ?? '');
      setIsDirty(false);
    },
    [builtinTemplates, customTemplates]
  );

  const handleSelectOutput = useCallback(
    (output: ManifestOutput) => {
      if (output.generator === 'component-xml') {
        setSelectedTemplate('[component-xml]');
        setSelectedOutputEntry(output);
        setEditContent('');
        setIsDirty(false);
        return;
      }
      if (output.template) {
        // template name may itself be a Jinja2 expr; render it for lookup
        const resolvedName = renderExpr(output.template, context);
        selectTemplate(resolvedName, output);
      }
    },
    [selectTemplate, context]
  );

  const handleCopyBuiltin = useCallback(() => {
    if (!selectedTemplate) {
      return;
    }
    vscode?.postMessage({ type: 'copyBuiltin', templateName: selectedTemplate });
  }, [selectedTemplate]);

  const handleSave = useCallback(() => {
    if (!selectedTemplate || isReadOnly) {
      return;
    }
    setCustomTemplates((prev) => ({ ...prev, [selectedTemplate]: editContent }));
    setIsDirty(false);
    vscode?.postMessage({
      type: 'saveTemplate',
      templateName: selectedTemplate,
      content: editContent,
    });
    flash('Saved');
  }, [selectedTemplate, isReadOnly, editContent, flash]);

  const handleInitManifest = useCallback(() => {
    vscode?.postMessage({ type: 'initManifest' });
    flash('Initialising manifest…');
  }, [flash]);

  const handleGroupToggle = useCallback(
    (groupName: string, enabled: boolean) => {
      if (!manifest) {
        return;
      }
      const updated: ManifestData = {
        ...manifest,
        groups: { ...manifest.groups, [groupName]: { enabled } },
      };
      setManifest(updated);
      postSaveManifest(updated);
    },
    [manifest, postSaveManifest]
  );

  const handleAddOutput = useCallback(
    (output: ManifestOutput) => {
      if (!manifest) {
        return;
      }
      const updated: ManifestData = {
        ...manifest,
        outputs: [...manifest.outputs, output],
      };
      setManifest(updated);
      postSaveManifest(updated);
      setShowAddForm(false);
      flash('Output added');
    },
    [manifest, postSaveManifest, flash]
  );

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const allTemplateNames = Array.from(
    new Set([...Object.keys(builtinTemplates), ...Object.keys(customTemplates)])
  ).sort();

  const customNames = Object.keys(customTemplates).sort();
  const builtinOnlyNames = allTemplateNames.filter((n) => !(n in customTemplates));

  // Collect outputs per group for the manifest tree
  const groupedOutputs: Record<string, ManifestOutput[]> = {};
  const ungroupedOutputs: ManifestOutput[] = [];
  if (manifest) {
    for (const output of manifest.outputs) {
      if (output.group) {
        if (!groupedOutputs[output.group]) {
          groupedOutputs[output.group] = [];
        }
        groupedOutputs[output.group].push(output);
      } else {
        ungroupedOutputs.push(output);
      }
    }
  }

  const availableTemplates = allTemplateNames;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!initialized) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: FG,
          opacity: 0.5,
          fontSize: 14,
        }}
      >
        Loading templates…
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: BG_EDITOR,
        color: FG,
        fontFamily: 'var(--vscode-font-family, sans-serif)',
        fontSize: 13,
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 12px',
          borderBottom: BORDER,
          background: 'var(--vscode-titleBar-activeBackground)',
          color: 'var(--vscode-titleBar-activeForeground)',
          flexShrink: 0,
          minHeight: 36,
        }}
      >
        <span className="codicon codicon-file-code" style={{ fontSize: 15, marginRight: 2 }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>Template Editor</span>
        {customTemplateDir && (
          <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 4 }}>{customTemplateDir}</span>
        )}
        <div style={{ flex: 1 }} />
        {statusMsg && <span style={{ fontSize: 12, opacity: 0.8 }}>{statusMsg}</span>}
        {isCustom && !isComponentXml && (
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty}
            style={{
              padding: '3px 10px',
              fontSize: 12,
              background: isDirty
                ? 'var(--vscode-button-background)'
                : 'var(--vscode-button-secondaryBackground)',
              color: isDirty
                ? 'var(--vscode-button-foreground)'
                : 'var(--vscode-button-secondaryForeground)',
              border: 'none',
              borderRadius: 2,
              cursor: isDirty ? 'pointer' : 'not-allowed',
              opacity: isDirty ? 1 : 0.5,
            }}
          >
            Save
          </button>
        )}
      </div>

      {/* 3-column body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ── Left panel ── */}
        <div
          style={{
            width: 230,
            flexShrink: 0,
            borderRight: BORDER,
            overflowY: 'auto',
            background: BG_SIDEBAR,
            color: 'var(--vscode-sideBar-foreground)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {manifest === null ? (
            /* ── No-manifest mode ── */
            <>
              <div
                style={{
                  margin: 8,
                  padding: '10px 10px',
                  borderRadius: 4,
                  background: 'var(--vscode-editorInfo-background, rgba(0,100,220,0.08))',
                  border: '1px solid var(--vscode-editorInfo-border, rgba(0,100,220,0.2))',
                  fontSize: 12,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 6, opacity: 0.9 }}>
                  No manifest found
                </div>
                <div style={{ opacity: 0.7, marginBottom: 8, lineHeight: 1.4 }}>
                  Initialise <code>ipcraft.templates.yml</code> to enable manifest-driven generation
                  and group toggles.
                </div>
                <button
                  type="button"
                  onClick={handleInitManifest}
                  style={{
                    width: '100%',
                    padding: '4px 0',
                    fontSize: 12,
                    background: 'var(--vscode-button-background)',
                    color: 'var(--vscode-button-foreground)',
                    border: 'none',
                    borderRadius: 2,
                    cursor: 'pointer',
                  }}
                >
                  Initialise manifest
                </button>
              </div>

              {customNames.length > 0 && (
                <>
                  <SectionLabel label="Custom" />
                  {customNames.map((name) => (
                    <TemplateItem
                      key={name}
                      name={name}
                      isSelected={selectedTemplate === name}
                      isCustom={true}
                      onClick={() => selectTemplate(name)}
                    />
                  ))}
                </>
              )}
              <SectionLabel label="Built-in" />
              {builtinOnlyNames.map((name) => (
                <TemplateItem
                  key={name}
                  name={name}
                  isSelected={selectedTemplate === name}
                  isCustom={false}
                  onClick={() => selectTemplate(name)}
                />
              ))}
            </>
          ) : (
            /* ── Manifest mode: output tree ── */
            <>
              {/* Groups */}
              {Object.entries(manifest.groups).map(([groupName, groupCfg]) => {
                const outputs = groupedOutputs[groupName] ?? [];
                return (
                  <div key={groupName}>
                    <GroupHeader
                      name={groupName}
                      enabled={groupCfg.enabled}
                      onToggle={(enabled) => handleGroupToggle(groupName, enabled)}
                    />
                    {outputs.map((output, idx) => {
                      const renderedPath = renderExpr(output.path, context);
                      const templateKey = output.template
                        ? renderExpr(output.template, context)
                        : '[component-xml]';
                      const isBuiltin =
                        templateKey in builtinTemplates && !(templateKey in customTemplates);
                      const isSkipped = !isWhenTrue(output.when, context);
                      return (
                        <OutputItem
                          key={`${groupName}-${idx}`}
                          output={output}
                          renderedPath={renderedPath}
                          isSelected={selectedOutputEntry === output}
                          isBuiltin={isBuiltin}
                          isSkipped={isSkipped}
                          onClick={() => handleSelectOutput(output)}
                        />
                      );
                    })}
                  </div>
                );
              })}

              {/* Ungrouped outputs */}
              {ungroupedOutputs.length > 0 && (
                <div>
                  <SectionLabel label="Other" />
                  {ungroupedOutputs.map((output, idx) => {
                    const renderedPath = renderExpr(output.path, context);
                    const templateKey = output.template
                      ? renderExpr(output.template, context)
                      : '[component-xml]';
                    const isBuiltin =
                      templateKey in builtinTemplates && !(templateKey in customTemplates);
                    return (
                      <OutputItem
                        key={`ungrouped-${idx}`}
                        output={output}
                        renderedPath={renderedPath}
                        isSelected={selectedOutputEntry === output}
                        isBuiltin={isBuiltin}
                        isSkipped={false}
                        onClick={() => handleSelectOutput(output)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Add output */}
              <div style={{ marginTop: 'auto', borderTop: BORDER }}>
                {showAddForm ? (
                  <AddOutputForm
                    groups={Object.keys(manifest.groups)}
                    templates={availableTemplates}
                    onAdd={handleAddOutput}
                    onCancel={() => setShowAddForm(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      padding: '6px 10px',
                      fontSize: 12,
                      background: 'transparent',
                      color: FG,
                      border: 'none',
                      cursor: 'pointer',
                      opacity: 0.6,
                    }}
                  >
                    <span className="codicon codicon-add" />
                    Add output
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* ── Center panel: editor ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: BG_EDITOR,
          }}
        >
          {selectedTemplate === null ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                opacity: 0.4,
                fontSize: 13,
              }}
            >
              {manifest !== null
                ? 'Select an output entry from the left panel'
                : 'Select a template from the left panel'}
            </div>
          ) : isComponentXml ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                height: '100%',
                opacity: 0.55,
                fontSize: 13,
                gap: 8,
              }}
            >
              <span className="codicon codicon-circuit-board" style={{ fontSize: 32 }} />
              <span>
                This output uses the built-in{' '}
                <code style={{ fontFamily: MONO }}>component-xml</code> generator
              </span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>No template to edit</span>
            </div>
          ) : (
            <>
              {/* Read-only banner */}
              {isReadOnly && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    background: 'var(--vscode-editorInfo-background, rgba(0,100,220,0.08))',
                    borderBottom: BORDER,
                    flexShrink: 0,
                    fontSize: 12,
                  }}
                >
                  <span className="codicon codicon-lock" style={{ opacity: 0.7 }} />
                  <span style={{ opacity: 0.8 }}>Built-in template — read only</span>
                  <button
                    type="button"
                    onClick={handleCopyBuiltin}
                    style={{
                      marginLeft: 'auto',
                      padding: '2px 10px',
                      fontSize: 12,
                      background: 'var(--vscode-button-background)',
                      color: 'var(--vscode-button-foreground)',
                      border: 'none',
                      borderRadius: 2,
                      cursor: 'pointer',
                    }}
                  >
                    Copy to custom templates
                  </button>
                </div>
              )}
              {/* Output path chip (when viewing via manifest tree) */}
              {selectedOutputEntry && (
                <div
                  style={{
                    padding: '3px 12px',
                    fontSize: 11,
                    opacity: 0.6,
                    borderBottom: BORDER,
                    flexShrink: 0,
                    fontFamily: MONO,
                    background: 'var(--vscode-tab-activeBackground)',
                  }}
                >
                  output: {renderExpr(selectedOutputEntry.path, context)}
                </div>
              )}
              {/* Template name tab */}
              <div
                style={{
                  padding: '4px 12px',
                  fontSize: 11,
                  opacity: 0.55,
                  borderBottom: BORDER,
                  flexShrink: 0,
                  fontFamily: MONO,
                  background: 'var(--vscode-tab-activeBackground)',
                }}
              >
                {selectedTemplate}
                {isCustom && isDirty && ' •'}
              </div>
              {/* Textarea */}
              <textarea
                value={editContent}
                readOnly={isReadOnly}
                onChange={(e) => {
                  if (!isReadOnly) {
                    setEditContent(e.target.value);
                    setIsDirty(true);
                  }
                }}
                spellCheck={false}
                style={{
                  flex: 1,
                  resize: 'none',
                  border: 'none',
                  outline: 'none',
                  padding: '12px 16px',
                  fontFamily: MONO,
                  fontSize: 'var(--vscode-editor-font-size, 13px)',
                  lineHeight: 1.5,
                  background: isReadOnly
                    ? 'var(--vscode-editor-inactiveSelectionBackground, rgba(0,0,0,0.04))'
                    : BG_EDITOR,
                  color: FG,
                  opacity: isReadOnly ? 0.8 : 1,
                  tabSize: 2,
                }}
              />
            </>
          )}
        </div>

        {/* ── Right panel: preview ── */}
        <div
          style={{
            width: 340,
            flexShrink: 0,
            borderLeft: BORDER,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            background: BG_EDITOR,
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              opacity: 0.5,
              borderBottom: BORDER,
              flexShrink: 0,
              background: 'var(--vscode-tab-activeBackground)',
            }}
          >
            Preview
          </div>
          {previewError ? (
            <div
              style={{
                padding: 12,
                color: 'var(--vscode-errorForeground)',
                fontFamily: MONO,
                fontSize: 12,
                whiteSpace: 'pre-wrap',
              }}
            >
              {previewError}
            </div>
          ) : (
            <pre
              style={{
                flex: 1,
                margin: 0,
                padding: '12px 16px',
                overflow: 'auto',
                fontFamily: MONO,
                fontSize: 'var(--vscode-editor-font-size, 12px)',
                lineHeight: 1.5,
                color: FG,
                opacity: 0.85,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {selectedTemplate === null || isComponentXml ? (
                <span style={{ opacity: 0.4 }}>Select a template to preview</span>
              ) : (
                preview || <span style={{ opacity: 0.4 }}>Rendering…</span>
              )}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
