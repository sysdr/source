import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Narrow Vitest config for payroll/TDS/filings-disclaimer Stryker (RW-009c). */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: [
      'services/payrollCalculator.test.ts',
      'services/tdsRules.test.ts',
      'services/filings/disclaimer.test.ts',
      'services/mutationKill.test.ts',
    ],
  },
});
