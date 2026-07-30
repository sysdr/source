/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['clear-text', 'json', 'html'],
  json: {
    fileName: 'context/reports/mutation_report_people.json',
  },
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: [
    'services/employeeSelfService.ts',
    'services/displayPii.ts',
    'services/employeeLifecycle.ts',
  ],
  thresholds: {
    high: 80,
    low: 60,
    break: null,
  },
  timeoutMS: 60_000,
  concurrency: 2,
  warnings: {
    unknownOptions: false,
  },
  vitest: {
    configFile: 'vitest.people.config.ts',
    related: false,
  },
};
