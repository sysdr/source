/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['clear-text', 'json', 'html'],
  json: {
    fileName: 'context/reports/mutation_report_payroll.json',
  },
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: [
    'services/payrollCalculator.ts',
    'services/tdsRules.ts',
    'services/filings/disclaimer.ts',
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
    configFile: 'vitest.payroll.config.ts',
    related: false,
  },
};
