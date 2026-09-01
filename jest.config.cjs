/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.json' },
    ],
  },
  roots: ['<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  moduleNameMapper: {
    '^@llm-query/types$': '<rootDir>/packages/types/src/index.ts',
    '^@llm-query/errors$': '<rootDir>/packages/errors/src/index.ts',
    '^@llm-query/proxy$': '<rootDir>/packages/proxy/src/index.ts',
    '^@llm-query/queue$': '<rootDir>/packages/queue/src/index.ts',
    '^@llm-query/orchestrator$': '<rootDir>/packages/orchestrator/src/index.ts',
    '^@llm-query/adapters-gemini$': '<rootDir>/packages/adapters-gemini/src/index.ts',
    '^@llm-query/adapters-chatgpt$': '<rootDir>/packages/adapters-chatgpt/src/index.ts',
    '^@llm-query/worker-runtime$': '<rootDir>/packages/worker-runtime/src/index.ts',
  },
};
