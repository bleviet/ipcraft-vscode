import * as fs from 'fs';
import * as path from 'path';
import { readBdJson } from '../../../../parser/system/BdJsonReader';

// Run against real Vivado files with: IPCRAFT_BD_SAMPLES=<dir with *.bd files> npx jest --config config/jest.config.js <this file>
const samples = process.env.IPCRAFT_BD_SAMPLES;
const describeSamples = samples ? describe : describe.skip;

const files = samples
  ? fs
      .readdirSync(samples)
      .filter((f) => f.endsWith('.bd'))
      .sort()
  : [];

describeSamples('readBdJson: real .bd files', () => {
  it('finds .bd files in IPCRAFT_BD_SAMPLES', () => {
    expect(`${samples}: ${files.length} .bd files`).not.toMatch(/: 0 \.bd files$/);
  });

  it.each(files)('reads %s', (file) => {
    const text = fs.readFileSync(path.join(samples as string, file), 'utf8');
    const graph = readBdJson(text, file);
    const instances = Object.values(graph.instances);

    expect(instances.length).toBeGreaterThan(0);
    for (const instance of instances) {
      expect(Object.keys(graph.levels)).toContain(instance.parent);
      if (instance.kind !== 'blackbox') {
        expect(instance.line).toBeGreaterThan(0);
      }
    }

    for (const net of graph.nets) {
      expect(net.line).toBeGreaterThan(0);
      for (const ref of net.endpoints) {
        const pins =
          ref.instance === null
            ? graph.levels[net.level]?.boundaryPins
            : graph.instances[ref.instance]?.pins;
        const pin = pins?.find((p) => p.name === ref.pin);
        expect(pin).toBeDefined();
        // A module reference must declare every pin its nets use (`pinsComplete`).
        if (ref.instance !== null && graph.instances[ref.instance]?.pinsComplete) {
          expect(pin?.line).toBeGreaterThan(0);
        }
      }
    }

    for (const segment of graph.addressSegments) {
      expect(graph.instances[segment.masterInstance]).toBeDefined();
      expect(graph.instances[segment.slaveInstance]).toBeDefined();
      if (segment.range !== undefined) {
        expect(segment.range).toMatch(/^0x[0-9A-F]+$/);
      }
    }
  });
});
