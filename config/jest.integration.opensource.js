const baseConfig = require('./jest.integration');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  displayName: 'integration-open-source',
  // Licensed vendor-tool suites run on the self-hosted vendor workflow.
  // Every other integration test is included automatically.
  testPathIgnorePatterns: [
    '<rootDir>/src/test/integration/vivado\\.test\\.ts$',
    '<rootDir>/src/test/integration/quartus\\.test\\.ts$',
  ],
};
