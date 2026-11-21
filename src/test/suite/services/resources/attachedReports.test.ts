import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  AttachedReports,
  isCopy,
  type AttachedStore,
} from '../../../../services/resources/attachedReports';

let root: string;
let workspace: string;
let outside: string;
let storage: string;
let store: AttachedStore & { values: Map<string, unknown> };

function memento(): AttachedStore & { values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: (key, value) => {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
      return Promise.resolve();
    },
  };
}

const reportsFor = (design: string) =>
  new AttachedReports(store, design, (file) => file.startsWith(workspace + path.sep));

function write(dir: string, name: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `content of ${name}`);
  return file;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-attached-'));
  workspace = path.join(root, 'ws');
  outside = path.join(root, 'downloads');
  storage = path.join(root, 'storage');
  store = memento();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('AttachedReports', () => {
  it('links a file inside the workspace and does not copy it', async () => {
    const inside = write(path.join(workspace, 'runs'), 'impl.rpt');
    const record = await reportsFor('file:///ws/a.bd').attachFiles([inside], storage);

    expect(record.storedFiles).toEqual([inside]);
    expect(record.originalName).toBe('impl.rpt');
    expect(isCopy(record)).toBe(false);
    expect(fs.existsSync(storage)).toBe(false);
  });

  it('copies a file outside the workspace to <storage>/resource-reports/<id>/<name>', async () => {
    const download = write(outside, 'impl.rpt');
    const record = await reportsFor('file:///ws/a.bd').attachFiles([download], storage);

    expect(record.id).toMatch(/^[0-9a-f]{16}$/);
    expect(record.storedFiles).toEqual([
      path.join(storage, 'resource-reports', record.id, 'impl.rpt'),
    ]);
    expect(fs.readFileSync(record.storedFiles[0], 'utf8')).toBe('content of impl.rpt');
    expect(isCopy(record)).toBe(true);
    expect(Date.parse(record.attachedAt)).not.toBeNaN();
  });

  it('keeps the files of one report together in one record', async () => {
    const files = [write(outside, 'spike.fit.rpt'), write(outside, 'spike.fit.summary')];
    const record = await reportsFor('file:///ws/a.bd').attachFiles(files, storage);
    expect(record.storedFiles.map((f) => path.basename(f))).toEqual([
      'spike.fit.rpt',
      'spike.fit.summary',
    ]);
    expect(new Set(record.storedFiles.map((f) => path.dirname(f))).size).toBe(1);
  });

  it('refuses to copy when there is no storage', async () => {
    const download = write(outside, 'impl.rpt');
    await expect(reportsFor('file:///ws/a.bd').attachFiles([download], undefined)).rejects.toThrow(
      /no extension storage/
    );
    expect(reportsFor('file:///ws/a.bd').list()).toEqual([]);
  });

  it('removes the copies it made and the record, never a linked workspace file', async () => {
    const reports = reportsFor('file:///ws/a.bd');
    const inside = write(path.join(workspace, 'runs'), 'impl.rpt');
    const download = write(outside, 'other.rpt');
    const linked = await reports.attachFiles([inside], storage);
    const copied = await reports.attachFiles([download], storage);

    await reports.remove(copied.id);
    expect(fs.existsSync(path.dirname(copied.storedFiles[0]))).toBe(false);
    expect(fs.existsSync(download)).toBe(true);
    expect(reports.list()).toEqual([linked]);

    await reports.remove(linked.id);
    expect(fs.existsSync(inside)).toBe(true);
    expect(reports.list()).toEqual([]);
    expect(store.values.size).toBe(0);
  });

  it('keeps the records of each design apart', async () => {
    const download = write(outside, 'impl.rpt');
    const first = await reportsFor('file:///ws/a.bd').attachFiles([download], storage);
    const second = await reportsFor('file:///ws/b.bd').attachFiles([download], storage);

    expect(reportsFor('file:///ws/a.bd').list()).toEqual([first]);
    expect(reportsFor('file:///ws/b.bd').list()).toEqual([second]);
    expect([...store.values.keys()].sort()).toEqual([
      'ipcraft.resources.attached:file:///ws/a.bd',
      'ipcraft.resources.attached:file:///ws/b.bd',
    ]);
    await reportsFor('file:///ws/a.bd').remove(first.id);
    expect(reportsFor('file:///ws/b.bd').list()).toEqual([second]);
    expect(fs.existsSync(second.storedFiles[0])).toBe(true);
  });

  it('ignores the removal of an unknown id', async () => {
    await expect(reportsFor('file:///ws/a.bd').remove('nope')).resolves.toBeUndefined();
  });
});
