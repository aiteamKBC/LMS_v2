import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const frontendRoot = fileURLToPath(new URL('..', import.meta.url));
const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [
        ['line'],
        ['html', { outputFolder: fileURLToPath(new URL('../playwright-report', import.meta.url)), open: 'never' }],
      ]
    : 'list',
  outputDir: fileURLToPath(new URL('../test-results/playwright', import.meta.url)),
  use: {
    baseURL,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    cwd: frontendRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    { name: 'learner', use: { viewport: { width: 390, height: 844 } } },
    { name: 'apprentice', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'staff', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'employer', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'verify', use: { viewport: { width: 412, height: 915 } } },
  ],
});
