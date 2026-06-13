const fs = require('fs');
const path = require('path');

const requiredFile = path.resolve(__dirname, '../ipcraft-spec/schemas/ip_core.schema.json');

if (!fs.existsSync(requiredFile)) {
  console.error('Error: ipcraft-spec submodule is not initialized or files are missing.');
  console.error('Please run the following command to initialize and clone the submodule:');
  console.error('    git submodule update --init --recursive');
  process.exit(1);
}

console.log('ipcraft-spec submodule check passed.');
