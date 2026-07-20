const fs = require('fs');
const path = require('path');

const sourceDir = path.resolve(__dirname, '../src/test/e2e/fixtures');
const destinationDir = path.resolve(__dirname, '../out/test/e2e/fixtures');
const fixtureNames = ['test.mm.yml', 'test.ip.yml'];

fs.mkdirSync(destinationDir, { recursive: true });

for (const fixtureName of fixtureNames) {
  fs.copyFileSync(path.join(sourceDir, fixtureName), path.join(destinationDir, fixtureName));
}

console.log(`Copied ${fixtureNames.length} E2E fixtures to ${destinationDir}.`);
