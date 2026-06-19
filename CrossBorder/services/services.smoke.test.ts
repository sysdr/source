import { describe, expect, it } from 'vitest';

if (!(globalThis as Record<string, unknown>).DOMMatrix) {
  (globalThis as Record<string, unknown>).DOMMatrix = class DOMMatrixMock {};
}
if (!(globalThis as Record<string, unknown>).ImageData) {
  (globalThis as Record<string, unknown>).ImageData = class ImageDataMock {};
}
if (!(globalThis as Record<string, unknown>).Path2D) {
  (globalThis as Record<string, unknown>).Path2D = class Path2DMock {};
}

const modules = [
  './apService',
  './filingCalendarService',
  './foreignIncomeService',
  './geminiService',
  './investorPitchMetricsService',
  './journalService',
  './llpBankStatementIngestionService',
  './payrollCalculator',
  './statutoryReports',
  './substackIngestionService',
  './taxComputationService',
  './taxService',
  './usTaxService',
  './withholdingService',
] as const;

describe('service modules', () => {
  it.each(modules)('loads %s without runtime errors', async (modulePath) => {
    const moduleExports = await import(modulePath);
    expect(Object.keys(moduleExports).length).toBeGreaterThan(0);
  });
});
