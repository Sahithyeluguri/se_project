module.exports = {
  projects: [
    {
      displayName: "logic",
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/**/*.test.cjs"],
      collectCoverageFrom: ["<rootDir>/tests/**/*.test.cjs"],
    },
    {
      displayName: "system",
      testEnvironment: "jsdom",
      testMatch: ["<rootDir>/tests/**/*.system.test.jsx"],
      setupFilesAfterEnv: ["<rootDir>/tests/setupTests.cjs"],
      transform: {
        "^.+\\.[jt]sx?$": "babel-jest",
      },
      moduleFileExtensions: ["js", "jsx", "cjs", "json"],
      collectCoverageFrom: ["<rootDir>/src/**/*.{js,jsx}"],
    },
  ],
};
