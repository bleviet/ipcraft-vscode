import * as fs from 'fs';
import * as path from 'path';
import { stringify } from 'yaml';
import {
  createEmptyRecipe,
  parseRecipe,
  validateRecipeSemantics,
} from '../../../dataInspector/recipe';
import { YamlValidator } from '../../../services/YamlValidator';
import { applyPathEdits } from '../../../yamledit';

const schemaPath = path.join(
  process.cwd(),
  'ipcraft-spec',
  'schemas',
  'data_inspector.schema.json'
);
const examplesDir = path.join(process.cwd(), 'ipcraft-spec', 'examples', 'data_inspector');

describe('Data Inspector recipes', () => {
  it('keeps every bundled Data Inspector example schema- and semantically valid', () => {
    const validator = new YamlValidator();
    const exampleFiles = fs.readdirSync(examplesDir).filter((file) => file.endsWith('.ipci.yml'));

    expect(exampleFiles).not.toHaveLength(0);
    for (const file of exampleFiles) {
      const recipe = parseRecipe(fs.readFileSync(path.join(examplesDir, file), 'utf8'));

      expect(validator.validateAgainstSchema(recipe, schemaPath)).toEqual({ valid: true });
      expect(validateRecipeSemantics(recipe)).toEqual([]);
    }
  });

  it('validates the generated empty recipe against the canonical schema', () => {
    const result = new YamlValidator().validateAgainstSchema(
      createEmptyRecipe('address-decode'),
      schemaPath
    );

    expect(result).toEqual({ valid: true });
  });

  it('accepts optional canvas positions without changing the recipe version', () => {
    const recipe = createEmptyRecipe('canvas');
    recipe.view.canvas = {
      nodes: [
        { id: 'input', x: 40, y: 120 },
        { id: 'result', x: 480, y: 160 },
      ],
    };

    const result = new YamlValidator().validateAgainstSchema(recipe, schemaPath);

    expect(result).toEqual({ valid: true });
    expect(recipe.version).toBe(1);
  });

  it('rejects transient samples and capture histories at the schema boundary', () => {
    const recipe = { ...createEmptyRecipe('unsafe'), sample: "32'hDEADBEEF" };
    const result = new YamlValidator().validateAgainstSchema(recipe, schemaPath);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('additional properties');
  });

  describe('import provenance', () => {
    const withProvenance = (importProvenance: unknown) => {
      const recipe = createEmptyRecipe('provenance');
      recipe.fields = [
        {
          id: 'ready',
          sourceId: 'input',
          name: 'READY',
          msb: 0,
          lsb: 0,
          groupId: 'default',
          display: { interpretation: 'hex' },
          importProvenance,
        } as never,
      ];
      return recipe;
    };
    const validate = (importProvenance: unknown) =>
      new YamlValidator().validateAgainstSchema(withProvenance(importProvenance), schemaPath);

    it.each([
      ['register', { sourceFile: 'a.mm.yml', registerName: 'CTRL' }],
      ['top-level port', { sourceFile: 'a.ip.yml', portName: 'o_status' }],
      ['bus port', { sourceFile: 'a.ip.yml', busInterface: 'm_axis', portName: 'TDATA' }],
    ])('accepts and round-trips %s provenance', (_name, provenance) => {
      const recipe = withProvenance(provenance);

      expect(validate(provenance)).toEqual({ valid: true });
      expect(parseRecipe(stringify(recipe)).fields[0].importProvenance).toEqual(provenance);
    });

    it.each([
      ['mixed register and port', { sourceFile: 'a.yml', registerName: 'R', portName: 'p' }],
      ['port without sourceFile', { portName: 'p' }],
      ['empty port name', { sourceFile: 'a.yml', portName: '' }],
      ['unknown key', { sourceFile: 'a.yml', portName: 'p', extra: 1 }],
    ])('rejects %s provenance', (_name, provenance) => {
      expect(validate(provenance).valid).toBe(false);
    });
  });

  it('round-trips definitions without inventing a transient value', () => {
    const parsed = parseRecipe(`
version: 1
name: flags
sources:
  - id: input
    name: INPUT
    width: 8
fields:
  - id: ready
    sourceId: input
    name: READY
    msb: 0
    lsb: 0
    groupId: default
    display:
      interpretation: unsigned
overlayGroups:
  - id: default
    name: Default
steps: []
view:
  laneWidth: 8
  zoom: field
`);

    expect(parsed.fields[0].name).toBe('READY');
    expect(parsed).not.toHaveProperty('sample');
    expect(parsed).not.toHaveProperty('samples');
    expect(validateRecipeSemantics(parsed)).toEqual([]);
  });

  it('checks references, ordered dependencies, widths, and same-group overlap', () => {
    const recipe = createEmptyRecipe('invalid');
    recipe.fields = [
      {
        id: 'a',
        sourceId: 'input',
        name: 'A',
        msb: 7,
        lsb: 4,
        groupId: 'default',
        display: { interpretation: 'hex' },
      },
      {
        id: 'b',
        sourceId: 'input',
        name: 'B',
        msb: 5,
        lsb: 2,
        groupId: 'default',
        display: { interpretation: 'hex' },
      },
    ];
    recipe.steps = [
      { id: 'late', type: 'not', inputId: 'future' },
      { id: 'future', type: 'slice', inputId: 'input', msb: 40, lsb: 0 },
    ];

    expect(validateRecipeSemantics(recipe)).toEqual(
      expect.arrayContaining([
        'B overlaps A at bit 4 in group default',
        'Step late references unavailable input future',
        'Step future slice [40:0] is outside its input',
      ])
    );
  });

  it('allows intentional overlap across named groups', () => {
    const recipe = createEmptyRecipe('alternatives');
    recipe.overlayGroups.push({ id: 'signed-view', name: 'Signed view' });
    recipe.fields = [
      {
        id: 'raw',
        sourceId: 'input',
        name: 'RAW',
        msb: 7,
        lsb: 0,
        groupId: 'default',
        display: { interpretation: 'hex' },
      },
      {
        id: 'signed',
        sourceId: 'input',
        name: 'SIGNED',
        msb: 7,
        lsb: 0,
        groupId: 'signed-view',
        display: { interpretation: 'signed' },
      },
    ];

    expect(validateRecipeSemantics(recipe)).toEqual([]);
  });

  it('uses format-preserving YAML edits for recipe updates', () => {
    const original = `# shared decode setup
version: 1
name: old-name # keep this note
description: ""
sources:
  - id: input
    name: INPUT
    width: 32
fields: []
overlayGroups:
  - id: default
    name: Default
steps: []
view:
  laneWidth: 32
  zoom: field
`;
    const next = createEmptyRecipe('new-name');
    const edited = applyPathEdits(original, [{ path: [], value: next }]);

    expect(edited).toContain('# shared decode setup');
    expect(edited).toContain('name: new-name # keep this note');
    expect(parseRecipe(edited).name).toBe('new-name');
  });
});
