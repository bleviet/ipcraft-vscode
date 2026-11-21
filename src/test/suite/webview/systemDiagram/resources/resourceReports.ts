/** Real ResourceReports for the tests of the resource view: the spike fixtures through the phase 1a functions. */
import { readBdJson } from '../../../../../parser/system/BdJsonReader';
import { readQsys } from '../../../../../parser/system/QsysReader';
import type { ResourceReport } from '../../../../../domain/resourceUsage';
import {
  mapHierarchyReport,
  mapOocReports,
} from '../../../../../services/resources/mapReportToGraph';
import { parseQuartusEntities } from '../../../../../services/resources/quartusEntityTable';
import {
  readQuartusCapacity,
  readVivadoFlat,
} from '../../../../../services/resources/resourceMetrics';
import { parseVivadoHierarchy } from '../../../../../services/resources/vivadoHierarchyTable';
import { quartusFixture, vivadoFixture } from '../../../services/resources/fixtures';

export const vivadoGraph = readBdJson(vivadoFixture('sys.bd'), 'sys.bd');
export const quartusGraph = readQsys(quartusFixture('sys.qsys'), 'sys.qsys');

/** Post-route hierarchical report with the device capacity of the flat report. */
export const vivadoReport: ResourceReport = mapHierarchyReport(
  {
    table: parseVivadoHierarchy(vivadoFixture('routed_hier.rpt')),
    vendor: 'vivado',
    stage: 'routed',
    source: { fileName: 'routed_hier.rpt' },
    capacity: readVivadoFlat(vivadoFixture('routed_flat.rpt')).capacity,
  },
  vivadoGraph
);

/** Quartus fitter report with the capacity of the fitter summary. */
export const quartusReport: ResourceReport = mapHierarchyReport(
  {
    table: parseQuartusEntities(quartusFixture('spike.fit.rpt')),
    vendor: 'quartus',
    stage: 'fit',
    source: { fileName: 'spike.fit.rpt' },
    capacity: readQuartusCapacity(quartusFixture('spike.fit.summary')),
  },
  quartusGraph
);

/** Per-IP out-of-context reports: `/hier_0` is a sum of the IPs inside. */
export const oocReport: ResourceReport = mapOocReports(
  ['sys_axi_gpio_0_0', 'sys_axi_bram_ctrl_0_0', 'sys_bram_0_0', 'sys_smartconnect_0_0'].map(
    (design) => ({
      design,
      text: vivadoFixture(`ooc/${design}_utilization_synth.rpt`),
    })
  ),
  vivadoGraph,
  { fileName: 'ooc' }
);
