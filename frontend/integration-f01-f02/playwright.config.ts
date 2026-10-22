import { defineConfig } from '@playwright/test';

// No dotenv, webServer, global setup, browser download or integrated fallback.
if (process.env.F01F02_BROWSER_MODE && process.env.F01F02_BROWSER_MODE !== 'mock') {
  throw new Error('Integrated browser mode is disabled pending separate authorization');
}
if (process.env.F01F02_BROWSER_EXECUTE !== 'approved-mocked-local') {
  throw new Error('Explicit mocked-browser execution authorization required');
}
const baseURL = process.env.F01F02_BROWSER_URL;
if (!baseURL) throw new Error('Supply the reviewed local static test server URL');
const url = new URL(baseURL);
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('Only an explicit IPv4 loopback static origin is allowed');
}

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', fullyParallel: false, workers: 1,
  retries: 0, timeout: 30_000, forbidOnly: true,
  reporter: [['list']], outputDir: './artifacts',
  use: { baseURL, browserName: 'chromium', serviceWorkers: 'block',
    acceptDownloads: false, trace: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'english-light-desktop', use: { locale: 'en-GB', colorScheme: 'light', viewport: { width: 1440, height: 900 } } },
    { name: 'arabic-dark-mobile', use: { locale: 'ar', colorScheme: 'dark', viewport: { width: 390, height: 844 } } },
  ],
});
