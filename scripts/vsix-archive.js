const yauzl = require('yauzl');

function readVsixArchive(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, archive) => {
      if (openError) {
        reject(openError);
        return;
      }

      const entries = [];
      let manifest;
      let manifestRead = false;
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      archive.on('entry', (entry) => {
        if (!entry.fileName.endsWith('/')) {
          entries.push({ name: entry.fileName, size: entry.uncompressedSize });
        }

        if (entry.fileName !== 'extension/package.json' || manifestRead) {
          archive.readEntry();
          return;
        }

        manifestRead = true;
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }

          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            try {
              manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              archive.readEntry();
            } catch (error) {
              fail(error);
            }
          });
        });
      });
      archive.on('error', fail);
      archive.on('end', () => {
        if (settled) return;
        if (!manifestRead) {
          fail(new Error('VSIX is missing extension/package.json'));
          return;
        }
        settled = true;
        resolve({
          entries,
          manifest,
          archiveFiles: new Set(entries.map((entry) => entry.name)),
        });
      });
      archive.readEntry();
    });
  });
}

module.exports = { readVsixArchive };
