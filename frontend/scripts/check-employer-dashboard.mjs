/* global document, innerWidth */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// Standalone frontend server: no .env loading, backend proxy, database, or live API.
const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'employer-dashboard-'));
console.log('Screenshots: ' + output);
const server = await createServer({ configFile: false, envDir: false, root, plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 4319, strictPort: true, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const base = 'http://127.0.0.1:4319';
  for (const [width, zoom] of [[1672, 1], [1440, 1], [1100, 1], [768, 1], [390, 1], [320, 1], [1440, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base || /(?:_api|\/api)(?:\/|$)/.test(url.pathname) || request.method() !== 'GET'
          || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__employer_dashboard') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employer dashboard check</title><style>html{zoom:${zoom}}</style><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/employer-dashboard-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(base + '/__employer_dashboard' + (width === 1672 ? '?sidebar=true' : ''));
    await expect(page.getByRole('heading', { name: 'Example employer' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Alex Learner programme progress' })).toHaveAttribute('aria-valuenow', '68');
    const layout = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    await page.screenshot({ path: join(output, width + '-zoom' + zoom + '.png'), fullPage: true });
    expect(layout.document, 'Page width at ' + width + '/' + zoom).toBeLessThanOrEqual(layout.viewport + 1);
    await page.getByRole('combobox', { name: 'Programme', exact: true }).selectOption('Data Analysis');
    await expect(page.getByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    await page.getByRole('searchbox').fill('No matching learner');
    await expect(page.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    expect(errors).toEqual([]);
    if (width === 1440 && zoom === 1) {
      await page.goto(base + '/__employer_dashboard?scenario=empty');
      await expect(page.getByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
      await page.goto(base + '/__employer_dashboard?scenario=missing');
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await page.goto(base + '/__employer_dashboard?scenario=many');
      await page.getByRole('button', { name: 'Next learner page' }).click();
      await expect(page.getByRole('navigation', { name: 'Learner pages' })).toContainText('Page 2 of 2');
      await expect(page.getByRole('region', { name: 'Employer learners' }).getByRole('row')).toHaveCount(5);
      await page.goto(base + '/__employer_dashboard');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await expect(page.getByRole('heading', { name: 'Example employer' })).toBeVisible();
      await page.screenshot({ path: join(output, '1440-dark.png'), fullPage: true });
    }
    expect(errors).toEqual([]);
    await page.close();
    console.log('PASS viewport=' + width + ', zoom=' + zoom);
  }
  console.log('Screenshots: ' + output);
} finally {
  await browser?.close();
  await server.close();
}

