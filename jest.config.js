const { pathsToModuleNameMapper } = require('ts-jest');

// Keep Jest path aliases in sync with tsconfig.json
const { compilerOptions } = require('./tsconfig.json');

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths || {}, {
    // rootDir is `src`, while tsconfig paths are relative to repo root.
    // This keeps `src/*` -> `<rootDir>/$1`.
    prefix: '<rootDir>/../',
  }),
};
