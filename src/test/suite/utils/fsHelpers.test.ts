import * as path from 'path';
import * as fs from 'fs/promises';
import { fileExists } from '../../../utils/fsHelpers';

describe('fsHelpers', () => {
  const tempFile = path.join(__dirname, 'temp_test_file.txt');

  afterEach(async () => {
    try {
      await fs.unlink(tempFile);
    } catch {
      // Ignore if file doesn't exist
    }
  });

  it('returns true if a file exists', async () => {
    await fs.writeFile(tempFile, 'hello');
    const exists = await fileExists(tempFile);
    expect(exists).toBe(true);
  });

  it('returns false if a file does not exist', async () => {
    const exists = await fileExists(path.join(__dirname, 'non_existent_file.txt'));
    expect(exists).toBe(false);
  });
});
