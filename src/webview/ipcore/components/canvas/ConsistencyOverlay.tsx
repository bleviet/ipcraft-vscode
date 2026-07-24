import React, { useMemo, useState } from 'react';
import {
  CONSISTENCY_KIND_LABEL,
  type ConsistencyFinding,
  type ConsistencySummary,
  elementIdForFinding,
  findingKey,
  formatFindingsForClipboard,
  sourceLabel,
} from '../../types/consistency';

interface ConsistencyOverlayProps {
  findings: ConsistencyFinding[];
  summary: ConsistencySummary;
  ignoredKeys: Set<string>;
  onIgnore: (key: string) => void;
  onAdopt: (finding: ConsistencyFinding) => void;
  onSelectElement: (elementId: string) => void;
  onRegenerate: () => void;
  onRecheck: () => void;
  isChecking: boolean;
  onClose: () => void;
}

const SeverityDot: React.FC<{ severity: 'amber' | 'red' }> = ({ severity }) => (
  <span
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      flexShrink: 0,
      background:
        severity === 'red'
          ? 'var(--vscode-editorError-foreground, #f14c4c)'
          : 'var(--vscode-editorWarning-foreground, #cca700)',
    }}
  />
);

const FindingRow: React.FC<{
  finding: ConsistencyFinding;
  onIgnore: () => void;
  onAdopt?: () => void;
  onSelect?: () => void;
}> = ({ finding, onIgnore, onAdopt, onSelect }) => (
  <div
    className="staging-tree-row staging-tree-file"
    style={{
      paddingLeft: 10,
      alignItems: 'flex-start',
      gap: 6,
      minHeight: 'auto',
      padding: '6px 10px',
    }}
  >
    <SeverityDot severity={finding.severity} />
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        {CONSISTENCY_KIND_LABEL[finding.kind]} · {sourceLabel(finding.source)}
      </div>
      <div style={{ fontSize: 12, wordBreak: 'break-word' }}>{finding.message}</div>
    </div>
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      {onAdopt && (
        <button
          className="staging-btn-action staging-btn-overwrite"
          onClick={onAdopt}
          title="Add this to the .ip.yml"
        >
          Adopt
        </button>
      )}
      {onSelect && (
        <button
          className="staging-btn-action"
          onClick={onSelect}
          title="Select the affected element on the canvas"
        >
          Inspect
        </button>
      )}
      <button className="staging-btn-action" onClick={onIgnore} title="Dismiss for this session">
        Ignore
      </button>
    </div>
  </div>
);

export const ConsistencyOverlay: React.FC<ConsistencyOverlayProps> = ({
  findings,
  summary,
  ignoredKeys,
  onIgnore,
  onAdopt,
  onSelectElement,
  onRegenerate,
  onRecheck,
  isChecking,
  onClose,
}) => {
  const visible = useMemo(
    () => findings.filter((f) => !ignoredKeys.has(findingKey(f))),
    [findings, ignoredKeys]
  );

  const grouped = useMemo(() => {
    const bySource = new Map<string, ConsistencyFinding[]>();
    for (const finding of visible) {
      const list = bySource.get(finding.source) ?? [];
      list.push(finding);
      bySource.set(finding.source, list);
    }
    return bySource;
  }, [visible]);

  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    const text = formatFindingsForClipboard(visible, summary);
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="canvas-inspector" style={{ width: 340 }}>
      <div className="ci-header" style={{ flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="staging-header-title">Consistency Check</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="ci-header__close"
              onClick={handleCopy}
              title="Copy all messages to clipboard"
              disabled={visible.length === 0}
              style={visible.length === 0 ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
            >
              <span className={`codicon codicon-${copied ? 'check' : 'copy'}`} />
            </button>
            <button className="ci-header__close" onClick={onClose} title="Close">
              <span className="codicon codicon-close" />
            </button>
          </div>
        </div>
        {visible.length > 0 ? (
          <div className="staging-summary" style={{ fontSize: 11 }}>
            {summary.added > 0 && (
              <span className="staging-summary-item">{summary.added} added</span>
            )}
            {summary.removed > 0 && (
              <span className="staging-summary-item">{summary.removed} removed</span>
            )}
            {summary.changed > 0 && (
              <span className="staging-summary-item">{summary.changed} changed</span>
            )}
            {summary.ambiguous > 0 && (
              <span className="staging-summary-item">{summary.ambiguous} ambiguous</span>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            ✓ Consistent with every checked implementation source.
          </div>
        )}
      </div>

      <div className="ci-body" style={{ padding: '8px 0' }}>
        {[...grouped.entries()].map(([source, sourceFindings]) => (
          <div key={source}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.6,
                padding: '4px 10px',
                textTransform: 'uppercase',
                letterSpacing: '0.03em',
              }}
            >
              {sourceLabel(sourceFindings[0].source)} ({sourceFindings.length})
            </div>
            {sourceFindings.map((finding, i) => {
              const elementId = elementIdForFinding(finding);
              return (
                <FindingRow
                  key={`${findingKey(finding)}:${i}`}
                  finding={finding}
                  onIgnore={() => onIgnore(findingKey(finding))}
                  onAdopt={finding.inferred ? () => onAdopt(finding) : undefined}
                  onSelect={elementId ? () => onSelectElement(elementId) : undefined}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="ci-footer" style={{ gap: 6, justifyContent: 'flex-start' }}>
        <button
          className="canvas-view-toggle"
          style={{ fontSize: 12 }}
          onClick={onRecheck}
          disabled={isChecking}
        >
          {isChecking ? 'Checking…' : 'Re-check'}
        </button>
        <button className="canvas-view-toggle" style={{ fontSize: 12 }} onClick={onRegenerate}>
          Keep .ip.yml & Regenerate
        </button>
      </div>
    </div>
  );
};
