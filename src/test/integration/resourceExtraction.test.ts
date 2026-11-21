/**
 * Runs the real extraction of a routed checkpoint through the real `runProcess` with the local
 * Vivado. Skipped unless IPCRAFT_VIVADO_DCP (a routed .dcp) is set; IPCRAFT_VIVADO_BIN is the
 * Vivado executable (default: `vivado` on PATH); IPCRAFT_VIVADO_DESIGN is the module name of the
 * design inside the top (default: the module of the first row under the top).
 *
 *   IPCRAFT_VIVADO_DCP=<proj>.runs/impl_1/<top>_routed.dcp npm run test:integration:... -- resourceExtraction
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SystemGraph } from '../../domain/systemGraph';
import { runProcess } from '../../services/BuildRunner';
import { extractToCache, type RunVivado } from '../../services/resources/extractVivadoReports';
import { mapHierarchyReport } from '../../services/resources/mapReportToGraph';
import { recognizeReport } from '../../services/resources/reportKind';
import { readVivadoFlat } from '../../services/resources/resourceMetrics';
import { parseVivadoHierarchy } from '../../services/resources/vivadoHierarchyTable';

const dcp = process.env.IPCRAFT_VIVADO_DCP;
const vivado = process.env.IPCRAFT_VIVADO_BIN ?? 'vivado';
const describeVivado = dcp ? describe : describe.skip;

describeVivado(
  'extracting a resource report from a routed checkpoint with the local Vivado',
  () => {
    let storage: string;

    beforeAll(() => {
      storage = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-extract-it-'));
    });

    afterAll(() => {
      fs.rmSync(storage, { recursive: true, force: true });
    });

    it('writes a hierarchical report recognized as routed and maps the design root', async () => {
      const lines: string[] = [];
      const run: RunVivado = async ({ args, cwd }) => {
        const result = await runProcess(vivado, args, {
          cwd,
          outputChannel: { appendLine: (line) => lines.push(line) },
        });
        return { ...result, output: lines.slice(-20).join('\n') };
      };

      const reports = await extractToCache({ dcp: dcp as string, storage, run });

      const hierarchical = fs.readFileSync(reports.hierarchical as string, 'utf8');
      const recognition = recognizeReport(hierarchical);
      expect(recognition).toMatchObject({
        recognized: true,
        kind: 'vivado-hierarchical',
        stage: 'routed',
      });
      const flat = recognizeReport(fs.readFileSync(reports.flat, 'utf8'));
      expect(flat).toMatchObject({ recognized: true, kind: 'vivado-flat', stage: 'routed' });

      // The design is the block design inside the wrapper: the module of the first row under the top
      // (IPCRAFT_VIVADO_DESIGN names it when the checkpoint is laid out differently).
      const table = parseVivadoHierarchy(hierarchical);
      const design = process.env.IPCRAFT_VIVADO_DESIGN ?? table.root.children[0]?.module;
      expect(design).toBeTruthy();
      const graph = {
        name: design,
        source: { fileName: `${design}.bd`, format: 'vivado-bd' },
        levels: { '/': { path: '/', instances: [], boundaryPins: [] } },
        instances: {},
        nets: [],
        addressSegments: [],
        diagnostics: [],
      } as unknown as SystemGraph;
      const report = mapHierarchyReport(
        {
          table,
          vendor: 'vivado',
          stage: 'routed',
          source: { fileName: path.basename(reports.hierarchical as string) },
          capacity: readVivadoFlat(fs.readFileSync(reports.flat, 'utf8')).capacity,
        },
        graph
      );
      expect(report.root).toBeDefined();
      expect(report.rootCandidates.length).toBeGreaterThan(0);
      expect(report.design.total.some((value) => value > 0)).toBe(true);

      // A second extraction of the unchanged checkpoint reuses the reports: no new run.
      const calls = lines.length;
      await extractToCache({ dcp: dcp as string, storage, run });
      expect(lines).toHaveLength(calls);
    });
  }
);
