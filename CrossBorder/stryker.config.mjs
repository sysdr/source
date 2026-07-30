/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['clear-text', 'json', 'html'],
  json: {
    fileName: 'context/reports/mutation_report.json',
  },
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: [
    'services/decimalMath.ts',
    'services/tdsRules.ts',
    'services/onboardingValidation.ts',
    'services/retentionPolicy.ts',
    'services/consolidatedPosition.ts',
    'services/complianceStatusEngine.ts',
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
  vitest: {
    configFile: 'vite.config.ts',
    related: true,
  },
};
