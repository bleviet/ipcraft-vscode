import React, { useEffect, useState } from 'react';
import type { IpCore } from '../../../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../../../types/editor';
import {
  validateRequired,
  validateVersion,
  validateVhdlIdentifier,
} from '../../../../../shared/utils/validation';
import { PropField, PropTextArea, Section } from '../controls/InspectorFields';
import {
  buildAddSubcoreMessage,
  buildCheckFilesExistMessage,
  buildOpenFileMessage,
  buildSelectFilesMessage,
  listenForInspectorHostMessage,
  sendInspectorMessage,
} from '../inspectorMessages';

export const BodyPanel: React.FC<{ ipCore: IpCore; onUpdate: YamlUpdateHandler }> = ({
  ipCore,
  onUpdate,
}) => (
  <>
    <Section title="VLNV">
      <PropField
        label="Vendor"
        value={ipCore.vlnv.vendor}
        onSave={(v) => onUpdate(['vlnv', 'vendor'], v)}
        validate={validateRequired}
        placeholder="my-company.com"
      />
      <PropField
        label="Library"
        value={ipCore.vlnv.library}
        onSave={(v) => onUpdate(['vlnv', 'library'], v)}
        validate={validateRequired}
        placeholder="my_lib"
        mono
      />
      <PropField
        label="Name"
        value={ipCore.vlnv.name}
        onSave={(v) => onUpdate(['vlnv', 'name'], v)}
        validate={(v) => validateVhdlIdentifier(v)}
        placeholder="my_core"
        mono
      />
      <PropField
        label="Version"
        value={ipCore.vlnv.version}
        onSave={(v) => onUpdate(['vlnv', 'version'], v)}
        validate={validateVersion}
        placeholder="1.0.0"
        mono
      />
    </Section>
    <Section title="Details">
      <PropField
        label="Author"
        value={ipCore.author ?? ''}
        onSave={(v) => onUpdate(['author'], v || null)}
        placeholder="Author name or team"
      />
      <PropTextArea
        label="Description"
        value={ipCore.description ?? ''}
        onSave={(v) => onUpdate(['description'], v || null)}
        placeholder="Describe this IP core…"
      />
    </Section>
    <FileSetsSection ipCore={ipCore} onUpdate={onUpdate} />
    <DependenciesSection ipCore={ipCore} onUpdate={onUpdate} />
  </>
);

// ─────────────────────────────────────────────────────
//  Source files section (body panel)
// ─────────────────────────────────────────────────────

interface FsFileEntry {
  path: string;
  type: string;
  managed?: boolean;
  version?: string;
}

const VHDL_VERSION_OPTIONS = ['', '87', '93', '2002', '2008', '2019'];

interface FsFileSet {
  name: string;
  files?: FsFileEntry[];
}

const FileSetsSection: React.FC<{ ipCore: IpCore; onUpdate: YamlUpdateHandler }> = ({
  ipCore,
  onUpdate,
}) => {
  const fileSets =
    ((ipCore as unknown as Record<string, unknown>).fileSets as FsFileSet[] | undefined) ?? [];
  const [fileExistence, setFileExistence] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const allPaths = fileSets.flatMap((fs) => (fs.files ?? []).map((f) => f.path));
    if (!allPaths.length) {
      return;
    }
    const stopListening = listenForInspectorHostMessage('filesExistResult', (message) => {
      setFileExistence((previous) => ({ ...previous, ...message.results }));
    });
    sendInspectorMessage(buildCheckFilesExistMessage(allPaths));
    return stopListening;
  }, [fileSets]);

  if (!fileSets.length) {
    return null;
  }

  const handleOpenFile = (path: string) => {
    if (fileExistence[path] === false) {
      return;
    }
    sendInspectorMessage(buildOpenFileMessage(path));
  };

  const handleAddFiles = (setIdx: number) => {
    const existing = fileSets[setIdx].files ?? [];
    listenForInspectorHostMessage('filesSelected', (message) => {
      if (message.files.length) {
        const newFiles = message.files.map((path) => ({
          path,
          type: fsInferType(path),
        }));
        onUpdate(['fileSets', setIdx, 'files'], [...existing, ...newFiles]);
      }
    });
    sendInspectorMessage(buildSelectFilesMessage({ multi: true }));
  };

  const handleRemoveFile = (setIdx: number, fileIdx: number) => {
    const files = fileSets[setIdx].files ?? [];
    const updated = files.filter((_, i) => i !== fileIdx);
    onUpdate(['fileSets', setIdx, 'files'], updated.length ? updated : undefined);
  };

  const handleToggleManaged = (setIdx: number, fileIdx: number) => {
    const files = fileSets[setIdx].files ?? [];
    const file = files[fileIdx];
    const updatedFile: FsFileEntry = { ...file };
    if (file.managed === false) {
      delete updatedFile.managed;
    } else {
      updatedFile.managed = false;
    }
    const updatedFiles = [...files];
    updatedFiles[fileIdx] = updatedFile;
    onUpdate(['fileSets', setIdx, 'files'], updatedFiles);
  };

  const handleSetVersion = (setIdx: number, fileIdx: number, version: string) => {
    const files = fileSets[setIdx].files ?? [];
    const updatedFile: FsFileEntry = { ...files[fileIdx] };
    if (version) {
      updatedFile.version = version;
    } else {
      delete updatedFile.version;
    }
    const updatedFiles = [...files];
    updatedFiles[fileIdx] = updatedFile;
    onUpdate(['fileSets', setIdx, 'files'], updatedFiles);
  };

  const allFiles = fileSets.flatMap((fs) => fs.files ?? []);
  const allLocked = allFiles.length > 0 && allFiles.every((f) => f.managed === false);

  const handleLockAll = () => {
    const updated = fileSets.map((fs) => ({
      ...fs,
      files: (fs.files ?? []).map((f) => ({ ...f, managed: false as const })),
    }));
    onUpdate(['fileSets'], updated);
  };

  const handleUnlockAll = () => {
    const updated = fileSets.map((fs) => ({
      ...fs,
      files: (fs.files ?? []).map((f) => {
        const { managed: _managed, ...rest } = f;
        return rest;
      }),
    }));
    onUpdate(['fileSets'], updated);
  };

  const sectionActions =
    allFiles.length > 0 ? (
      <button
        className="ci-section__action-btn"
        onClick={allLocked ? handleUnlockAll : handleLockAll}
        title={
          allLocked
            ? 'Unlock all files — allow IPCraft to overwrite on regeneration'
            : 'Lock all files — protect all from overwrite'
        }
        type="button"
        style={{ color: allLocked ? 'var(--vscode-statusBarItem-warningForeground)' : undefined }}
      >
        <span className={`codicon ${allLocked ? 'codicon-unlock' : 'codicon-lock'}`} />
        <span>{allLocked ? 'Unlock All' : 'Lock All'}</span>
      </button>
    ) : undefined;

  return (
    <Section title="Source Files" actions={sectionActions}>
      {fileSets.map((fs, setIdx) => (
        <div key={setIdx} className="ci-fileset">
          {fileSets.length > 1 && <div className="ci-fileset__group">{fs.name}</div>}
          {(fs.files ?? []).length === 0 && <div className="ci-override-empty">No files</div>}
          {(fs.files ?? []).map((file, fileIdx) => {
            const filename = file.path.split('/').pop() ?? file.path;
            const missing = fileExistence[file.path] === false;
            return (
              <div key={fileIdx} className="ci-fileset__row">
                <span
                  className={`codicon ${missing ? 'codicon-warning' : fsFileIcon(file.type)}`}
                  style={{
                    fontSize: 11,
                    color: missing ? 'var(--vscode-errorForeground)' : undefined,
                    opacity: missing ? 1 : 0.55,
                    flexShrink: 0,
                  }}
                />
                <span
                  className={`ci-fileset__name${missing ? ' ci-fileset__name--missing' : ''}`}
                  title={file.path}
                  onClick={() => handleOpenFile(file.path)}
                  style={{ cursor: missing ? 'not-allowed' : 'pointer' }}
                >
                  {filename}
                </span>
                {file.type === 'vhdl' && (
                  <select
                    className="ci-fileset__version"
                    value={file.version ?? ''}
                    onChange={(e) => handleSetVersion(setIdx, fileIdx, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    title="VHDL standard used by Vivado packaging"
                  >
                    {VHDL_VERSION_OPTIONS.map((v) => (
                      <option key={v} value={v}>
                        {v ? v : '2008 (default)'}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="ci-fileset__rm"
                  onClick={() => handleToggleManaged(setIdx, fileIdx)}
                  title={
                    file.managed === false
                      ? 'Allow IPCraft to overwrite this file on regeneration'
                      : 'Protect from overwrite — mark as user-managed'
                  }
                  type="button"
                  style={{
                    color:
                      file.managed === false
                        ? 'var(--vscode-statusBarItem-warningForeground)'
                        : undefined,
                    opacity: file.managed === false ? 1 : 0.35,
                  }}
                >
                  <span
                    className={`codicon ${file.managed === false ? 'codicon-lock' : 'codicon-unlock'}`}
                  />
                </button>
                <button
                  className="ci-fileset__rm"
                  onClick={() => handleRemoveFile(setIdx, fileIdx)}
                  title="Remove file"
                  type="button"
                >
                  <span className="codicon codicon-close" />
                </button>
              </div>
            );
          })}
          <button className="ci-fileset__add" onClick={() => handleAddFiles(setIdx)} type="button">
            <span className="codicon codicon-add" /> Add
          </button>
        </div>
      ))}
    </Section>
  );
};

function fsFileIcon(type: string): string {
  switch (type) {
    case 'vhdl':
    case 'verilog':
    case 'systemverilog':
      return 'codicon-circuit-board';
    case 'tcl':
      return 'codicon-terminal';
    case 'python':
      return 'codicon-snake';
    case 'xdc':
    case 'sdc':
    case 'ucf':
      return 'codicon-lock';
    case 'xml':
      return 'codicon-file-code';
    case 'pdf':
    case 'markdown':
    case 'text':
      return 'codicon-markdown';
    default:
      return 'codicon-file';
  }
}

function fsInferType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'vhd':
    case 'vhdl':
      return 'vhdl';
    case 'v':
      return 'verilog';
    case 'sv':
      return 'systemverilog';
    case 'tcl':
      return 'tcl';
    case 'py':
      return 'python';
    case 'xdc':
      return 'xdc';
    case 'sdc':
      return 'sdc';
    case 'ucf':
      return 'ucf';
    case 'xml':
      return 'xml';
    case 'pdf':
      return 'pdf';
    case 'md':
      return 'markdown';
    default:
      return 'unknown';
  }
}

// ─────────────────────────────────────────────────────
//  Dependencies section (inside BodyPanel)
// ─────────────────────────────────────────────────────

const DependenciesSection: React.FC<{ ipCore: IpCore; onUpdate: YamlUpdateHandler }> = ({
  ipCore,
  onUpdate,
}) => {
  const rawSubcores = (ipCore.subcores ?? []) as Array<string | { vlnv: string; path?: string }>;

  const handleAdd = () => {
    listenForInspectorHostMessage('subcoreAdded', (message) => {
      onUpdate(['subcores'], [...rawSubcores, message.vlnv]);
    });
    sendInspectorMessage(buildAddSubcoreMessage());
  };

  const handleDelete = (index: number) => {
    const updated = rawSubcores.filter((_, i) => i !== index);
    onUpdate(['subcores'], updated.length ? updated : null);
  };

  return (
    <Section title="Dependencies">
      {rawSubcores.length === 0 && <div className="ci-override-empty">No dependencies</div>}
      <div className="ci-fileset">
        {rawSubcores.map((sub, i) => {
          const vlnv = typeof sub === 'string' ? sub : sub.vlnv;
          const shortName = vlnv.split(':')[2] ?? vlnv;
          return (
            <div key={i} className="ci-fileset__row">
              <span className="codicon codicon-link" style={{ fontSize: 11, flexShrink: 0 }} />
              <span className="ci-fileset__name" title={vlnv}>
                {shortName}
              </span>
              <button
                className="ci-fileset__rm"
                title={`Remove ${vlnv}`}
                onClick={() => handleDelete(i)}
              >
                <span className="codicon codicon-trash" />
              </button>
            </div>
          );
        })}
        <button className="ci-fileset__add" onClick={handleAdd}>
          <span className="codicon codicon-add" />
          Add Dependency
        </button>
      </div>
    </Section>
  );
};

// ─────────────────────────────────────────────────────
//  Individual subcore / dependency panel
// ─────────────────────────────────────────────────────

interface SubcorePanelProps {
  entry: string | { vlnv: string; path?: string };
  index: number;
  ipCore: IpCore;
  onUpdate: YamlUpdateHandler;
}

export const SubcorePanel: React.FC<SubcorePanelProps> = ({ entry, index, ipCore, onUpdate }) => {
  const vlnv = typeof entry === 'string' ? entry : entry.vlnv;
  const path = typeof entry === 'object' ? entry.path : undefined;
  const rawSubcores = (ipCore.subcores ?? []) as Array<string | { vlnv: string; path?: string }>;

  const handleOpenFile = () => {
    if (path) {
      sendInspectorMessage(buildOpenFileMessage(path));
    }
  };

  return (
    <>
      <Section title="Dependency">
        <PropField
          label="VLNV"
          value={vlnv}
          onSave={(v) => {
            const current = rawSubcores[index];
            const updated = [...rawSubcores];
            if (typeof current === 'object') {
              updated[index] = { ...current, vlnv: v };
            } else {
              updated[index] = v;
            }
            onUpdate(['subcores'], updated);
          }}
          validate={validateRequired}
          placeholder="vendor:library:name:version"
          mono
        />
        {path !== undefined && (
          <PropField
            label="Path"
            value={path ?? ''}
            onSave={(v) => {
              const updated = [...rawSubcores];
              const current = updated[index];
              const base = typeof current === 'string' ? { vlnv: current } : { ...current };
              updated[index] = { ...base, path: v || undefined };
              onUpdate(['subcores'], updated);
            }}
            placeholder="path/to/core"
            mono
          />
        )}
      </Section>
      {path && (
        <div className="ci-fileset" style={{ paddingTop: 0 }}>
          <button className="ci-fileset__add" onClick={handleOpenFile}>
            <span className="codicon codicon-go-to-file" />
            Open File
          </button>
        </div>
      )}
    </>
  );
};
