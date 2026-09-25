/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Only look for specs under src/ so build/test.js (compiled output) and
  // src/test.ts (a model-seed script, not a test) are never picked up.
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/build/"],
  // The app imports absolute-from-repo-root paths like "src/config" (see
  // tsconfig baseUrl "./"). Jest has no baseUrl of its own, so resolve them
  // the same way: rootDir on the module search path.
  modulePaths: ["<rootDir>"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.spec.json" }],
  },
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
};
