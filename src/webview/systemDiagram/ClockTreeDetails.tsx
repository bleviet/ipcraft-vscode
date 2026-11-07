import React from 'react';
import type { PinRef, SystemGraph, SystemNet } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import type { ClockDomain, ResetSource } from './clocks/clockTypes';
import { UNRELEASED_RESET_COLOR } from './clocks/domainView';
import { formatHz, nameWithFrequency } from './clocks/frequency';
import { netTreeRows, pinRow, type TreePinRow, type TreeRow } from './clocks/netTree';
import { endKey } from './clocks/physicalNets';
import {
  domainRelations,
  frequencyCheck,
  resetRelations,
  resetSinkChecks,
  type RowCheck,
} from './clocks/treeChecks';
import { CheckMark } from './CheckMark';
import { CrossingNote } from './CrossingNote';
import { DomainDot } from './DomainLabel';
import { LineLink } from './LineLink';
import { nodeSelection, type Selection } from './model';
import { levelSource } from './sourceFile';

interface TreeDetailsProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  /** The selected net, which belongs to the tree. */
  net: SystemNet;
  onSelect: (selection: Selection) => void;
  onReveal: (line: number, uri?: string) => void;
}

/** Said where a domain or a reset has no pin that is known to drive it. */
const SOURCE_NOT_KNOWN =
  'Source not known: no rule or declared direction names one pin as the driver.';

const ROLE_TEXT: Partial<Record<TreePinRow['role'], string>> = {
  enter: 'enters hierarchy',
  exit: 'leaves hierarchy',
  forward: 'forwards the clock',
};

interface TreeListProps {
  rows: readonly TreeRow[];
  selectedNetId: string;
  /** Color of the tree's guide lines. */
  color: string;
  onSelect: TreeDetailsProps['onSelect'];
  /** The check to print after a load. */
  checkOf: (row: TreePinRow) => RowCheck | undefined;
}

/** A tree as indented rows: the nets of each level, the pins on the way, and a check per load. */
function TreeList({ rows, selectedNetId, color, onSelect, checkOf }: TreeListProps) {
  return (
    <ul className="sd-tree" style={{ ['--sd-tree-color' as string]: color }}>
      {rows.map((row, index) => {
        const indent = { marginLeft: (row.depth - 1) * 12 };
        if (row.kind === 'net') {
          return (
            <li key={`net:${row.net.id}`} className="sd-tree-level" style={indent}>
              {row.levelName} · net{' '}
              <button
                type="button"
                className="sd-link"
                onClick={() => onSelect({ kind: 'net', id: row.net.id })}
              >
                {row.net.name}
              </button>
              {row.net.id === selectedNetId && <span className="sd-tree-here">SELECTED</span>}
            </li>
          );
        }
        const check = row.role === 'load' ? checkOf(row) : undefined;
        return (
          <li key={`pin:${index}`} style={indent}>
            <button
              type="button"
              className="sd-link"
              onClick={() => onSelect(nodeSelection(row.nodeId))}
            >
              {row.label}
            </button>
            {ROLE_TEXT[row.role] && <span className="opacity-60"> {ROLE_TEXT[row.role]}</span>}
            {check && <CheckMark check={check} />}
          </li>
        );
      })}
    </ul>
  );
}

function SourceLine({
  graph,
  level,
  source,
  onSelect,
}: {
  graph: SystemGraph;
  level: string;
  source: PinRef;
  onSelect: TreeDetailsProps['onSelect'];
}) {
  const row = pinRow(graph, 'source', 0, level, source);
  return (
    <p>
      <span className="opacity-60">source</span>{' '}
      <button type="button" className="sd-link" onClick={() => onSelect(nodeSelection(row.nodeId))}>
        {row.label}
      </button>
    </p>
  );
}

/** Details of a net in a clock domain: the frequency, where it comes from, the tree, and the crossings. */
export function ClockTreeDetails({
  graph,
  clocks,
  domain,
  net,
  onSelect,
  onReveal,
}: TreeDetailsProps & { domain: ClockDomain }) {
  const origin = domain.frequencyFrom;
  const relations = domainRelations(clocks, domain);
  const rows = netTreeRows(graph, domain.sourceNetId, domain.sourceRef);
  const levelPlural = domain.levels === 1 ? 'level' : 'levels';
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">
          Clock net · domain <DomainDot color={domain.color} /> {domain.name}
        </div>
        <h2 className="sd-h2">{net.name}</h2>
        {domain.hz !== undefined && (
          <div className="sd-freq-big" style={{ color: domain.color }}>
            {formatHz(domain.hz)}
          </div>
        )}
      </header>
      {domain.sourceRef === undefined && <p className="sd-note">{SOURCE_NOT_KNOWN}</p>}
      {origin ? (
        <>
          <p>
            Requested by <code>{origin.parameter}</code> on {origin.owner}
            {origin.line !== undefined && (
              <>
                ,{' '}
                <LineLink
                  source={levelSource(graph, origin.level)}
                  line={origin.line}
                  onReveal={onReveal}
                />
              </>
            )}
            . <span className="sd-chip-tag">{origin.kind}</span>
          </p>
          <p className="sd-note">
            {origin.kind === 'script'
              ? 'This is the requested value. Vivado can round PS and clocking-wizard outputs during validation; the achieved frequency is not available offline.'
              : 'This is the frequency declared on the port.'}
          </p>
        </>
      ) : (
        <p className="sd-note">Frequency not set in the script.</p>
      )}
      <section>
        <h3 className="sd-h3">
          Clock tree · {domain.loads} loads in {domain.levels} {levelPlural}
        </h3>
        {domain.sourceRef && (
          <SourceLine
            graph={graph}
            level={domain.sourceLevel}
            source={domain.sourceRef}
            onSelect={onSelect}
          />
        )}
        <TreeList
          rows={rows}
          selectedNetId={net.id}
          color={domain.color}
          onSelect={onSelect}
          checkOf={(row) => {
            const expected = clocks.expectedFrequency(row.level, row.ref);
            return expected ? frequencyCheck(expected) : undefined;
          }}
        />
      </section>
      <section>
        <h3 className="sd-h3">Resets released on this domain</h3>
        {relations.resets.length > 0 ? (
          <p>
            {relations.resets.map((reset, index) => (
              <React.Fragment key={reset.id}>
                {index > 0 && ', '}
                <button
                  type="button"
                  className="sd-link"
                  onClick={() => onSelect({ kind: 'net', id: reset.netId })}
                >
                  {reset.label}
                </button>
              </React.Fragment>
            ))}
          </p>
        ) : (
          <p className="sd-note">
            No reset is synchronized to {domain.name}. Blocks on it receive a reset released on
            another domain.
          </p>
        )}
      </section>
      <section>
        <h3 className="sd-h3">Crossings with other domains</h3>
        {[...relations.crossings, ...relations.related].map((crossing) => (
          <CrossingNote
            key={crossing.id}
            crossing={crossing}
            onShowNet={(netId) => onSelect({ kind: 'net', id: netId })}
          />
        ))}
        {relations.crossings.length + relations.related.length === 0 && (
          <p className="opacity-70">None found.</p>
        )}
        {relations.spanning.length > 0 && (
          <p>
            Blocks also on another domain:{' '}
            {relations.spanning.map((block, index) => (
              <React.Fragment key={block.id}>
                {index > 0 && ', '}
                <button
                  type="button"
                  className="sd-link"
                  onClick={() => onSelect({ kind: 'instance', id: block.instance })}
                >
                  {graph.instances[block.instance]?.name ?? block.instance}
                </button>
              </React.Fragment>
            ))}
          </p>
        )}
      </section>
      <p>
        Net defined at{' '}
        <LineLink source={levelSource(graph, net.level)} line={net.line} onReveal={onReveal} />
      </p>
    </div>
  );
}

/** Details of a net of a reset tree: who releases it, each sink's check, and the reset domain crossings. */
export function ResetTreeDetails({
  graph,
  clocks,
  reset,
  net,
  onSelect,
  onReveal,
}: TreeDetailsProps & { reset: ResetSource }) {
  const checks = resetSinkChecks(clocks, reset);
  const relations = resetRelations(clocks, reset);
  const rows = netTreeRows(graph, reset.netId, reset.source);
  const color = reset.domain?.color ?? UNRELEASED_RESET_COLOR;
  const release = reset.async ? (
    'asynchronous'
  ) : reset.constant ? (
    'tied to a constant'
  ) : reset.domain ? (
    <>
      released on <DomainDot color={reset.domain.color} /> {reset.domain.name}
    </>
  ) : (
    'release clock unknown'
  );
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Reset net · {release}</div>
        <h2 className="sd-h2">{net.name}</h2>
      </header>
      {reset.source ? (
        <p>
          {reset.label}{' '}
          {reset.async
            ? 'is asserted and released asynchronously.'
            : reset.constant
              ? 'is tied to a constant and never toggles.'
              : reset.domain
                ? `is released synchronously to ${reset.domain.name}.`
                : 'has no rule that says which clock releases it.'}{' '}
          {reset.from && <span className="sd-chip-tag">{reset.from}</span>}
        </p>
      ) : (
        <p className="sd-note">{SOURCE_NOT_KNOWN}</p>
      )}
      <section>
        <h3 className="sd-h3">Reset tree · {reset.sinks.length} sinks</h3>
        {reset.source && (
          <SourceLine
            graph={graph}
            level={reset.level}
            source={{ instance: reset.source.instance, pin: reset.source.pin }}
            onSelect={onSelect}
          />
        )}
        <TreeList
          rows={rows}
          selectedNetId={net.id}
          color={color}
          onSelect={onSelect}
          checkOf={(row) => checks.get(endKey({ level: row.level, ...row.ref }))}
        />
      </section>
      <section>
        <h3 className="sd-h3">Reset domain crossings</h3>
        {[...relations.crossings, ...relations.related].map((crossing) => (
          <CrossingNote
            key={crossing.id}
            crossing={crossing}
            onShowNet={(netId) => onSelect({ kind: 'net', id: netId })}
          />
        ))}
        {relations.domains.map((domain) => (
          <p key={domain.id} className="sd-note">
            Give the blocks on {nameWithFrequency(domain)} their own proc_sys_reset with
            slowest_sync_clk on {domain.name}, so that their reset is released on their clock.
          </p>
        ))}
        {relations.crossings.length + relations.related.length === 0 && (
          <p className="opacity-70">None found.</p>
        )}
      </section>
      <p>
        Net defined at{' '}
        <LineLink source={levelSource(graph, net.level)} line={net.line} onReveal={onReveal} />
      </p>
    </div>
  );
}
