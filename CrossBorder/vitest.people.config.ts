import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/** Narrow Vitest config for People-slice Stryker dry runs. */
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
      'services/employeeSelfService.test.ts',
      'services/displayPii.test.ts',
      'services/employeeLifecycle.test.ts',
    ],
  },
});
