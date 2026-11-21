import React from 'react';
import type { ResourceReport } from '../../../domain/resourceUsage';
import { detailRows, notInReportNote, stageLabel, SUMMED_NOTE } from './resourceView';

/** The Resources section of a block's Details: every metric of the report, or why the block has none. */
export function ResourceDetails({
  report,
  compare,
  path,
}: {
  report: ResourceReport;
  /** Another source of the same design: its totals and the change go next to the report's. */
  compare?: ResourceReport;
  path: string;
}) {
  const rows = detailRows(report, path, compare);
  if (rows.length === 0 && !report.notInReport.includes(path)) {
    return null;
  }
  return (
    <section>
      <h3 className="sd-h3">Resources</h3>
      {rows.length === 0 ? (
        <p className="opacity-70">{notInReportNote(report)}</p>
      ) : (
        <>
          <p className="text-xs opacity-70">
            {stageLabel(report.stage)} · {report.source.fileName}
          </p>
          {compare && (
            <p className="text-xs opacity-70">
              Compared with {stageLabel(compare.stage)} · {compare.source.fileName}
            </p>
          )}
          <table className="sd-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>{compare ? `Total (${stageLabel(report.stage)})` : 'Total'}</th>
                {compare && <th>{`Total (${stageLabel(compare.stage)})`}</th>}
                {compare && <th>Change</th>}
                <th>Self</th>
                <th>% of design</th>
                <th>% of device</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="sd-num">{row.total}</td>
                  {compare && <td className="sd-num">{row.compared}</td>}
                  {compare && <td className="sd-num">{row.change}</td>}
                  <td className="sd-num">{row.self}</td>
                  <td className="sd-num">{row.ofDesign}</td>
                  <td className="sd-num">{row.ofDevice}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {report.instances[path].summed && (
            <p className="mt-2 text-xs opacity-70">{SUMMED_NOTE}</p>
          )}
        </>
      )}
    </section>
  );
}
