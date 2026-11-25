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

// Synthetic dashboard only; all API traffic is intercepted and external traffic is blocked.
const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'employer-performance-filter-'));
console.log('Screenshots: ' + output);
const server = await createServer({ configFile: false, envDir: false, root, plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const [width, zoom] of [[1672, 1], [1440, 1], [1100, 1], [768, 1], [390, 1], [320, 1], [1440, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === base && request.method() === 'GET' && /^\/learner_api\/employer-portal\/8\/learner\/(apprenticeship|commercial)\/\d+\/overview\/dashboard\/$/.test(url.pathname)) {
        const alex = url.pathname.includes('/11/');
        const id = alex ? 'current:alex' : 'legacy:morgan';
        return route.fulfill({ json: {
          metrics: { otjh: { actual: 20, targetToDate: 50 }, ksb: { completed: alex ? 1 : 3, total: 4, percent: alex ? 25 : 75 } },
          attendance: null, reviews: { completed: 1, total: 4, percent: 25 },
          hours: { months: [], planned: 50, end: '' }, programmeStartDate: null, programmeEndDate: null,
          modules: [{ id, title: alex ? 'Analysis' : 'Marketing', start: '', end: '',
            activities: { completed: 1, total: 2 }, hours: { actual: 20, planned: 50 },
            attendance: null, ksb: null, assignments: { submitted: alex ? 1 : 2, total: 2 } }],
          programme: [{ id, title: alex ? 'Analysis' : 'Marketing', percent: 50 }],
        } });
      }
      if (url.origin !== base || /^\/(?:[^/]+_api|api)(?:\/|$)/.test(url.pathname)
        || request.method() !== 'GET' || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__performance_filter') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employer performance filter</title><style>html{zoom:${zoom}}</style><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/employer-dashboard-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(base + '/__performance_filter');
    const filters = page.getByRole('form', { name: 'Filter learners', exact: true });
    const cards = page.getByRole('region', { name: 'Learning performance', exact: true });
    const expectCards = async (values) => {
      const labels = ['Average attendance', 'Assignment submission', 'Average off-the-job hours', 'Average KSBs', 'Reviews'];
      for (let index = 0; index < labels.length; index++) {
        await expect(cards.getByRole('button', { name: `${labels[index]}: ${values[index]}`, exact: true })).toBeVisible();
      }
      await expect(cards.getByRole('button')).toHaveCount(5);
      await expect(cards.getByRole('article', { name: 'Average performance: calculation pending' })).toBeVisible();
    };
    await expect(filters).toHaveCount(1);
    await expectCards(['70%', '75%', '80 h', '50%', '8']);
    const filterBounds = await filters.boundingBox();
    const cardBounds = await cards.boundingBox();
    expect(filterBounds.y + filterBounds.height).toBeLessThanOrEqual(cardBounds.y);
    const module = filters.getByRole('combobox', { name: 'Module', exact: true });
    await expect(module).toBeEnabled();
    await module.selectOption('legacy:morgan');
    await expectCards(['60%', '100%', '70 h', '75%', '4']);
    await cards.getByRole('button', { name: 'Average KSBs: 75%', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Average KSBs', exact: true });
    await expect(dialog.getByText('Morgan Learner', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Alex Learner', { exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await filters.getByRole('combobox', { name: 'Cohort', exact: true }).selectOption('Cohort A');
    await expectCards(['Unavailable', 'Unavailable', 'Unavailable', 'Unavailable', '0']);
    await filters.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(module).toHaveValue('');
    await expectCards(['70%', '75%', '80 h', '50%', '8']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: join(output, `${width}-zoom${zoom}.png`), fullPage: true });
    if (width === 1440 && zoom === 1) {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: join(output, '1440-dark.png'), fullPage: true });
    }
    expect(errors).toEqual([]);
    await page.close();
    console.log(`PASS viewport=${width}, zoom=${zoom}`);
  }
} finally {
  await browser?.close();
  await server.close();
}
