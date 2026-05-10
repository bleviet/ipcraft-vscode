/** @type {import('jest').Config} */
module.exports = {
    rootDir: '..',
    displayName: 'integration',
    preset: 'ts-jest',
    // Node environment: integration tests call child_process and real fs
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/test/integration/**/*.test.ts'],
    // EDA tools can take 60–120 s to start; set generous per-test timeout
    testTimeout: 180000,
    moduleNameMapper: {
        '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
        '^vscode$': '<rootDir>/__mocks__/vscode.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@services/(.*)$': '<rootDir>/src/services/$1',
        '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    },
    setupFilesAfterEnv: [],
    setupFiles: ['<rootDir>/src/test/integration/setup.ts'],
    transform: {
        '^.+\\.tsx?$': ['ts-jest', {
            tsconfig: {
                esModuleInterop: true,
                module: 'commonjs',
            },
            // Skip type-checking for speed — correctness is verified by unit tests
            diagnostics: false,
        }],
    },
    // Do not inherit unit-test coverage thresholds
    coverageThreshold: {},
    verbose: true,
    clearMocks: true,
    resetMocks: false,   // we need our setup.ts mutations to survive across tests
};
