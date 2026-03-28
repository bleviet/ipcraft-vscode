/* eslint-disable */
import * as path from 'path';
import Mocha from 'mocha';
import { sync } from 'glob';

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 20000,
  });

  const testsRoot = path.resolve(__dirname, '..');

  return new Promise((c, e) => {
    try {
      const files = sync('**/**.test.js', { cwd: testsRoot });
      console.log(`Found ${files.length} test files:`, files);

      // Add files to the test suite
      files.forEach((f: string) => {
        const fullPath = path.resolve(testsRoot, f);
        console.log(`Adding test file: ${fullPath}`);
        mocha.addFile(fullPath);
      });

      // Run the mocha test
      console.log('Running Mocha...');
      mocha.run((failures: number) => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      console.error(err);
      e(err);
    }
  });
}
