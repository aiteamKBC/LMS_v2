/* global document, innerWidth, getComputedStyle */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// Synthetic frontend only: no environment, backend proxy, authentication or live API.
const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'employer-reviews-'));
const server = await createServer({
  configFile: false, envDir: false, root, cacheDir: join(output, 'vite-cache'), plugins: [react()],
  optimizeDeps: { entries: ['scripts/employer-dashboard-fixture.tsx'] },
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: '127.0.0.1', port: 4323, strictPort: true, hmr: false },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const base = 'http://127.0.0.1:4323';
  for (const [width, zoom] of [[2048, 1], [1440, 1], [1100, 1], [768, 1], [390, 1], [320, 1], [1440, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 1050 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base || /(?:_api|\/api)(?:\/|$)/.test(url.pathname) || request.method() !== 'GET'
        || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__reviews') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employer reviews check</title><style>html{zoom:${zoom}}</style><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/employer-dashboard-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    const address = base + '/__reviews?view=reviews' + (width >= 1100 && zoom === 1 ? '&sidebar=true' : '');
    await page.goto(address);
    await expect(page.getByRole('heading', { name: 'Progress reviews', exact: true })).toBeVisible();
    const alex = page.getByRole('article', { name: 'Alex Learner reviews' });
    const morgan = page.getByRole('article', { name: 'Morgan Learner reviews' });
    await expect(alex.getByRole('listitem')).toHaveCount(6);
    await expect(morgan.getByText('1 awaiting your signature')).toBeVisible();
    await expect(morgan.getByRole('link', { name: 'View reviews for Morgan Learner' })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=reviews');
    const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(layout.width, `page overflow at ${width}/${zoom}`).toBeLessThanOrEqual(layout.viewport + 1);
    const first = await alex.boundingBox(), second = await morgan.boundingBox();
    expect(second.y).toBeGreaterThan(first.y + first.height);
    expect(Math.abs(first.width - second.width)).toBeLessThan(1);
    expect(await alex.getByRole('listitem').first().locator('strong').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(13);
    await page.screenshot({ path: join(output, `${width}-zoom${zoom}.png`), fullPage: true });

    await page.getByRole('combobox', { name: 'Upcoming review', exact: true }).selectOption('signature');
    await expect(page.getByText('1 of 2 learners')).toBeVisible();
    await expect(alex).toHaveCount(0);
    await page.getByRole('form', { name: 'Filter learners' }).getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByText('2 of 2 learners')).toBeVisible();
    await page.getByRole('searchbox').fill('No matching learner');
    await expect(page.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    await page.getByRole('region', { name: 'Progress review journey', exact: true }).getByRole('button', { name: 'Clear filters' }).click();
    await expect(alex).toBeVisible();
    if (width === 1440 && zoom === 1) {
      await page.goto(address + '&scenario=reviews-loading');
      await expect(alex.getByRole('status')).toHaveText('Loading progress reviews…');
      await page.goto(address + '&scenario=reviews-error');
      await expect(alex.getByRole('alert')).toContainText('could not be loaded');
      await page.goto(address + '&scenario=empty');
      await expect(page.getByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
      await page.goto(address + '&scenario=many');
      await expect(page.getByRole('article')).toHaveCount(12);
      await page.goto(address);
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: join(output, '1440-dark.png'), fullPage: true });
      await page.goto(base + '/__reviews?sidebar=true');
      await expect(page.getByRole('heading', { name: 'Example employer', exact: true })).toBeVisible();
      await expect(page.getByRole('progressbar', { name: 'Alex Learner programme progress' })).toHaveAttribute('aria-valuenow', '68');
    }
    expect(errors).toEqual([]);
    await page.close();
    console.log(`PASS reviews layout, filters and states: width=${width}, zoom=${zoom}`);
  }
  console.log('Screenshots: ' + output);
} finally {
  await browser?.close();
  await server.close();
}
