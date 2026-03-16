export default {
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      '.refs/**',
      '.claude/**',
      'tests/playwright/**',
    ],
    // Integration tests run separately via `make integration`
    testTimeout: 10000,
  },
};
