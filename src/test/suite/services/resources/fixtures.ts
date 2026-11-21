import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../../../fixtures/reports');

export const vivadoFixture = (name: string): string =>
  fs.readFileSync(path.join(ROOT, 'vivado/spike', name), 'utf8');

export const quartusFixture = (name: string, dir = 'platform_designer_system'): string =>
  fs.readFileSync(path.join(ROOT, 'quartus', dir, name), 'utf8');
