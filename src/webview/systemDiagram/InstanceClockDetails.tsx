import React from 'react';
import type { PinRef, SystemGraph, SystemInstance, SystemPin } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import type { ClockDomain } from './clocks/clockTypes';
import { nameWithFrequency } from './clocks/frequency';
import { instanceClocks, type InterfaceClockRow } from './clocks/instanceClocks';
import { frequencyCheck } from './clocks/treeChecks';
import { CheckMark } from './CheckMark';
import { DomainDot } from './DomainLabel';
import { endpointKey, isPlatformDesigner, netsByEndpoint, type Selection } from './model';

interface ClockDetailsProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  onSelect: (selection: Selection) => void;
}

/** A domain as a link to a net of it, with its dot and frequency. */
function DomainLink({
  domain,
  netId,
  onSelect,
}: {
  domain: ClockDomain;
  netId?: string;
  onSelect: ClockDetailsProps['onSelect'];
}) {
  const text = nameWithFrequency(domain);
  return (
    <>
      <DomainDot color={domain.color} />{' '}
      {netId === undefined ? (
        text
      ) : (
        <button
          type="button"
          className="sd-link"
          onClick={() => onSelect({ kind: 'net', id: netId })}
        >
          {text}
        </button>
      )}
    </>
  );
}

function clockedBy(row: InterfaceClockRow): string {
  if (row.knownFrom === undefined) {
    return 'unknown';
  }
  return row.clockPin ?? `any, all on ${row.domain?.name ?? 'one domain'}`;
}

/** Clock section of the details of a block: its clock pins, and for a leaf block the clock of each interface and reset. */
export function InstanceClockDetails({
  graph,
  clocks,
  instance,
  onSelect,
}: ClockDetailsProps & { instance: SystemInstance }) {
  const { clockPins, interfaces, resets, hasUnchecked } = instanceClocks(graph, clocks, instance);
  if (clockPins.length === 0) {
    return null;
  }
  return (
    <section>
      <h3 className="sd-h3">Clocks</h3>
      <table className="sd-table">
        <thead>
          <tr>
            <th>Clock pin</th>
            <th>Domain</th>
          </tr>
        </thead>
        <tbody>
          {clockPins.map((row) => (
            <tr key={row.pin}>
              <td>{row.pin}</td>
              <td>
                {row.domain ? (
                  <DomainLink domain={row.domain} netId={row.netId} onSelect={onSelect} />
                ) : (
                  <span className="opacity-60">unknown</span>
                )}
                {row.expected && <CheckMark check={frequencyCheck(row.expected)} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {interfaces.length > 0 && (
        <table className="sd-table mt-2">
          <thead>
            <tr>
              <th>Interface</th>
              <th>Clocked by</th>
              <th>Known from</th>
            </tr>
          </thead>
          <tbody>
            {interfaces.map((row) => (
              <tr key={row.pin}>
                <td>{row.pin}</td>
                <td className="sd-num">{clockedBy(row)}</td>
                <td>
                  <span className="sd-chip-tag">{row.knownFrom ?? 'not checked'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {resets.length > 0 && (
        <>
          <h3 className="sd-h3">Resets</h3>
          <table className="sd-table">
            <thead>
              <tr>
                <th>Reset pin</th>
                <th>Released by</th>
                <th>Check</th>
              </tr>
            </thead>
            <tbody>
              {resets.map((row) => (
                <tr key={row.pin}>
                  <td>{row.pin}</td>
                  <td>
                    <button
                      type="button"
                      className="sd-link"
                      onClick={() => onSelect({ kind: 'net', id: row.netId })}
                    >
                      {row.source.label}
                    </button>
                    {!row.source.source && <span className="opacity-60"> (source not known)</span>}
                  </td>
                  <td>{row.check && <CheckMark check={row.check} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {hasUnchecked && (
        <p className="sd-note mt-2">
          This block has clocks on different domains and the design file does not say which one each
          interface or reset belongs to.{' '}
          {isPlatformDesigner(graph.source.format)
            ? 'The definition of the block says it.'
            : 'Set the Vivado install directory to read ASSOCIATED_BUSIF and ASSOCIATED_RESET from the IP definition.'}
        </p>
      )}
    </section>
  );
}

/** Domain of an external clock port, or the domain that releases an external reset port. */
export function PortClockDetails({
  graph,
  clocks,
  level,
  pin,
  onSelect,
}: ClockDetailsProps & { level: string; pin: SystemPin }) {
  const ref: PinRef = { instance: null, pin: pin.name };
  const netId = netsByEndpoint(graph, level).get(endpointKey(ref))?.[0]?.id;
  const domain = clocks.domainOfPin(level, ref);
  const reset = clocks.resetOfPin(level, ref);
  if (domain) {
    return (
      <p>
        Clock domain <DomainLink domain={domain} netId={netId} onSelect={onSelect} />
      </p>
    );
  }
  if (!reset) {
    return null;
  }
  return (
    <p>
      Reset{' '}
      {reset.async ? (
        'asserted and released asynchronously'
      ) : reset.domain ? (
        <>
          released on{' '}
          <DomainLink domain={reset.domain} netId={reset.domain.sourceNetId} onSelect={onSelect} />
        </>
      ) : (
        'with an unknown release clock'
      )}
    </p>
  );
}
