/**
 * jest.config.mjs — Jest configuration for @workspace/api-server
 *
 * Uses ts-jest in ESM mode to run TypeScript test files directly.
 * Requires: NODE_OPTIONS=--experimental-vm-modules (set in package.json test script)
 */

/** @type {import('jest').Config} */
const config = {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    // Map workspace packages to their source for testing
    "^@workspace/db$": "<rootDir>/../../lib/db/src/index.ts",
    "^@workspace/api-zod$": "<rootDir>/../../lib/api-zod/src/index.ts",
    // Map .js extension imports to .ts sources (TypeScript ESM convention)
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        useESM: true,
        tsconfig: "<rootDir>/tsconfig.test.json",
      },
    ],
  },
  testMatch: ["**/__tests__/**/*.test.ts", "**/*.test.ts"],
  // Exclude the production build output
  // Paylabs has its own Vitest contract and is intentionally outside this
  // accounting/payment validation suite.
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/src/lib/paylabs\\.test\\.ts$"],
  // Only collect coverage from source (not tests)
  collectCoverageFrom: ["src/**/*.ts", "!src/**/__tests__/**"],
};

export default config;
