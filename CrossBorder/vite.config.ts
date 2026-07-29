import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 9000,
      host: '0.0.0.0',
      strictPort: true,
    },
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // esbuild 0.28+ refuses to lower destructuring for safari14; native
    // destructuring is fine for our browsers (Safari 14.1+ fixed the bug).
    esbuild: {
      supported: {
        destructuring: true,
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        supported: {
          destructuring: true,
        },
      },
    },
    build: {
      target: ['es2022', 'chrome87', 'edge88', 'firefox78', 'safari14.1'],
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/jspdf') || id.includes('node_modules/pdfjs-dist') || id.includes('node_modules/html2canvas')) {
              return 'pdf';
            }
            if (id.includes('node_modules/recharts')) {
              return 'charts';
            }
            if (id.includes('node_modules/@google/genai')) {
              return 'ai';
            }
            return undefined;
          },
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      include: ['**/*.{test,spec}.{ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/.stryker-tmp/**',
        '**/reports/**',
        '**/imported_software_factory/**',
      ],
      // Reduce cross-file mock / axe contention under high parallelism
      fileParallelism: true,
      maxWorkers: 4,
      testTimeout: 10_000,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['node_modules/', 'tests/', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
      },
    },
  };
});
