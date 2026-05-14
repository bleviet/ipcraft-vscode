import React, { useState, useEffect } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { vscode } from '../../../vscode';

interface FileEntry {
  path: string;
  type: string;
  managed?: boolean;
  description?: string;
}

interface FileSet {
  name: string;
  description?: string;
  files?: FileEntry[];
  import?: string;
}

interface Category {
  icon: string;
  label: string;
}

const TYPE_LABELS: Record<string, string> = {
  vhdl: 'VHDL',
  verilog: 'Verilog',
  systemverilog: 'SV',
  tcl: 'TCL',
  python: 'Python',
  xdc: 'XDC',
  sdc: 'SDC',
  ucf: 'UCF',
  xml: 'XML',
  pdf: 'PDF',
  markdown: 'Markdown',
  text: 'Text',
  unknown: '?',
};

function inferCategory(fs: FileSet): Category {
  const name = fs.name.toLowerCase();
  const types = (fs.files ?? []).map((f) => f.type);

  if (/tb|testbench|sim|cocotb/.test(name) || types.some((t) => t === 'python')) {
    return { icon: 'codicon-beaker', label: 'Testbench' };
  }
  if (/constraint|xdc|sdc/.test(name) || types.some((t) => ['xdc', 'sdc', 'ucf'].includes(t))) {
    return { icon: 'codicon-lock', label: 'Constraints' };
  }
  if (/doc|manual|readme/.test(name) || types.some((t) => ['pdf', 'markdown'].includes(t))) {
    return { icon: 'codicon-book', label: 'Documentation' };
  }
  if (
    /rtl|hdl|source|src/.test(name) ||
    types.some((t) => ['vhdl', 'verilog', 'systemverilog'].includes(t))
  ) {
    return { icon: 'codicon-circuit-board', label: 'RTL Sources' };
  }
  if (/integrat/.test(name) || types.some((t) => ['tcl', 'xml'].includes(t))) {
    return { icon: 'codicon-package', label: 'Integration' };
  }
  return { icon: 'codicon-folder', label: 'Files' };
}

function fileTypeIcon(type: string): string {
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

interface FileSetsProps {
  fileSets: unknown[];
  onUpdate?: YamlUpdateHandler;
}

export const FileSetsPanel: React.FC<FileSetsProps> = ({ fileSets: rawFileSets, onUpdate }) => {
  const fileSets = rawFileSets as FileSet[];
  const [fileExistence, setFileExistence] = useState<Record<string, boolean>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const allPaths = fileSets.flatMap((fs) => (fs.files ?? []).map((f) => f.path));
    if (allPaths.length === 0) {
      return;
    }

    vscode?.postMessage({ type: 'checkFilesExist', paths: allPaths });

    const handler = (event: MessageEvent) => {
      const msg = event.data as { type?: string; results?: Record<string, boolean> };
      if (msg.type === 'filesExistResult' && msg.results) {
        setFileExistence((prev) => ({ ...prev, ...msg.results }));
        window.removeEventListener('message', handler);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [fileSets]);

  if (fileSets.length === 0) {
    return null;
  }

  const allFiles = fileSets.flatMap((fs) => fs.files ?? []);
  const totalFiles = allFiles.length;
  const missingCount = allFiles.filter((f) => fileExistence[f.path] === false).length;

  const handleOpenFile = (filePath: string) => {
    if (fileExistence[filePath] === false) {
      return;
    }
    vscode?.postMessage({ type: 'openFile', path: filePath });
  };

  const handleToggleManaged = (fsName: string, fileIdx: number) => {
    if (!onUpdate) {
      return;
    }
    const fsIdx = fileSets.findIndex((fs) => fs.name === fsName);
    if (fsIdx === -1) {
      return;
    }
    const fs = fileSets[fsIdx];
    const file = (fs.files ?? [])[fileIdx];
    const updatedFile: FileEntry = { ...file };
    if (file.managed === false) {
      delete updatedFile.managed;
    } else {
      updatedFile.managed = false;
    }
    const updatedFiles = [...(fs.files ?? [])];
    updatedFiles[fileIdx] = updatedFile;
    const updated = [...fileSets];
    updated[fsIdx] = { ...fs, files: updatedFiles };
    onUpdate(['fileSets'], updated);
  };

  const toggleCollapse = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="codicon codicon-files" style={{ opacity: 0.7 }}></span>
        <span className="text-sm font-semibold" style={{ opacity: 0.9 }}>
          Source Files
        </span>
        <span
          className="text-xs px-1.5 py-0.5 rounded"
          style={{
            background: 'var(--vscode-badge-background)',
            color: 'var(--vscode-badge-foreground)',
          }}
        >
          {totalFiles}
        </span>
        {missingCount > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded flex items-center gap-1"
            style={{ background: 'var(--vscode-errorForeground)', color: 'white' }}
          >
            <span className="codicon codicon-warning"></span>
            {missingCount} missing
          </span>
        )}
      </div>

      {/* File set groups */}
      <div className="space-y-2">
        {fileSets.map((fs) => {
          const category = inferCategory(fs);
          const isCollapsed = collapsed.has(fs.name);
          const files = fs.files ?? [];
          const missingInSet = files.filter((f) => fileExistence[f.path] === false).length;

          return (
            <div
              key={fs.name}
              className="rounded overflow-hidden"
              style={{ border: '1px solid var(--vscode-panel-border)' }}
            >
              {/* Group header */}
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
                style={{
                  background: 'var(--vscode-sideBar-background)',
                  borderBottom: isCollapsed ? 'none' : '1px solid var(--vscode-panel-border)',
                }}
                onClick={() => toggleCollapse(fs.name)}
              >
                <span
                  className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`}
                  style={{ fontSize: '11px', opacity: 0.5 }}
                ></span>
                <span
                  className={`codicon ${category.icon}`}
                  style={{ fontSize: '13px', opacity: 0.75 }}
                ></span>
                <span className="text-sm font-medium">{fs.name}</span>
                {fs.description && (
                  <span className="text-xs" style={{ opacity: 0.5 }}>
                    {fs.description}
                  </span>
                )}
                {fs.import && (
                  <span className="text-xs font-mono" style={{ opacity: 0.5 }}>
                    → {fs.import}
                  </span>
                )}
                <span className="ml-auto text-xs" style={{ opacity: 0.45 }}>
                  {files.length} {files.length === 1 ? 'file' : 'files'}
                </span>
                {missingInSet > 0 && (
                  <span
                    className="codicon codicon-warning"
                    style={{ fontSize: '12px', color: 'var(--vscode-errorForeground)' }}
                    title={`${missingInSet} file(s) not found`}
                  ></span>
                )}
              </div>

              {/* File list */}
              {!isCollapsed && (
                <div>
                  {files.map((file, idx) => {
                    const missing = fileExistence[file.path] === false;
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-2 px-4 py-1"
                        style={{
                          borderBottom:
                            idx < files.length - 1
                              ? '1px solid var(--vscode-panel-border)'
                              : 'none',
                          background: missing
                            ? 'color-mix(in srgb, var(--vscode-errorForeground) 6%, transparent)'
                            : 'transparent',
                        }}
                      >
                        <span
                          className={`codicon ${missing ? 'codicon-warning' : fileTypeIcon(file.type)} flex-shrink-0`}
                          style={{
                            fontSize: '12px',
                            color: missing ? 'var(--vscode-errorForeground)' : undefined,
                            opacity: missing ? 1 : 0.6,
                          }}
                        ></span>
                        <span
                          className="text-xs font-mono flex-1 truncate"
                          title={missing ? `File not found: ${file.path}` : `Open: ${file.path}`}
                          onClick={() => handleOpenFile(file.path)}
                          style={{
                            cursor: missing ? 'not-allowed' : 'pointer',
                            color: missing
                              ? 'var(--vscode-errorForeground)'
                              : 'var(--vscode-textLink-foreground)',
                            textDecoration: missing ? 'line-through' : 'underline',
                            opacity: missing ? 0.7 : 1,
                          }}
                        >
                          {file.path}
                        </span>
                        <span
                          className="text-xs px-1 py-0.5 rounded flex-shrink-0"
                          style={{
                            background: 'var(--vscode-badge-background)',
                            color: 'var(--vscode-badge-foreground)',
                            opacity: 0.85,
                          }}
                        >
                          {TYPE_LABELS[file.type] ?? file.type}
                        </span>
                        {missing && (
                          <span
                            className="text-xs flex-shrink-0"
                            style={{ color: 'var(--vscode-errorForeground)', opacity: 0.8 }}
                          >
                            not found
                          </span>
                        )}
                        {onUpdate && (
                          <button
                            onClick={() => handleToggleManaged(fs.name, idx)}
                            className="flex-shrink-0 p-0.5 rounded"
                            title={
                              file.managed === false
                                ? 'Allow IPCraft to overwrite this file on regeneration'
                                : 'Protect from overwrite — mark as user-managed'
                            }
                            style={{
                              color:
                                file.managed === false
                                  ? 'var(--vscode-statusBarItem-warningForeground)'
                                  : undefined,
                              opacity: file.managed === false ? 1 : 0.35,
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <span
                              className={`codicon ${file.managed === false ? 'codicon-lock' : 'codicon-unlock'}`}
                              style={{ fontSize: '11px' }}
                            ></span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {fs.import && (
                    <div className="flex items-center gap-2 px-4 py-1.5" style={{ opacity: 0.7 }}>
                      <span className="codicon codicon-link-external text-xs"></span>
                      <span
                        className="text-xs font-mono"
                        onClick={() => handleOpenFile(fs.import!)}
                        style={{
                          cursor: fileExistence[fs.import] === false ? 'not-allowed' : 'pointer',
                          color: 'var(--vscode-textLink-foreground)',
                          textDecoration: 'underline',
                        }}
                      >
                        {fs.import}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
