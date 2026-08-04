/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'npm',
  reporters: ['clear-text', 'json', 'html'],
  json: {
    fileName: 'context/reports/mutation_report_filings.json',
  },
  testRunner: 'vitest',
  coverageAnalysis: 'perTest',
  mutate: [
    'services/filings/gstr1.ts',
    'services/filings/gstr3b.ts',
    'services/filings/form24q.ts',
    'services/filings/form26q.ts',
    'services/filings/epfEcr.ts',
    'services/filings/validateExport.ts',
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
    configFile: 'vitest.filings.config.ts',
    related: false,
  },
};
