import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Narrow Vitest config for filings-generator Stryker (RW-009d). */
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
      'services/filings/filings.test.ts',
      'services/filings/filings.mutation.test.ts',
      'services/filings/disclaimer.test.ts',
    ],
  },
});
