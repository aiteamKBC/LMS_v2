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

// Overview and My learners module filters. All data is synthetic; no .env or backend is used.
const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'employer-module-filter-'));
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
      if (url.origin === base && request.method() === 'GET' && /^\/learner_api\/employer-portal\/8\/learner\/(apprenticeship|commercial)\/\d+\/contracts\/$/.test(url.pathname)) {
        return route.fulfill({ json: { contracts: [], sources: { lms: 'ready', aptem: 'ready' } } });
      }
      if (url.origin === base && request.method() === 'GET' && /^\/learner_api\/employer-portal\/8\/learner\/(apprenticeship|commercial)\/\d+\/overview\/dashboard\/$/.test(url.pathname)) {
        const alex = url.pathname.includes('/11/');
        return route.fulfill({ json: {
          metrics: { otjh: { actual: 0, targetToDate: null }, ksb: { completed: 0, total: 0, percent: null } },
          reviews: { completed: 0, total: 0, percent: null }, hours: { months: [] },
          modules: [
            { id: 'current:shared', title: 'Shared module', start: alex ? '2026-09-01' : '2026-10-01',
              end: alex ? '2026-11-30' : '2026-12-31', activities: { completed: 1, total: 2 },
              hours: { actual: alex ? 40 : 20, planned: 50 }, ksb: { completed: alex ? 1 : 2, total: 2 },
              attendance: { attended: alex ? 4 : 3, total: 5 }, assignments: { submitted: alex ? 1 : 0, total: 2 } },
            { id: alex ? 'current:alex' : 'legacy:morgan', title: alex ? 'Data fundamentals' : 'Marketing strategy',
              start: '', end: '', activities: { completed: 0, total: 2 }, hours: { actual: alex ? .5 : 0, planned: 50 },
              ksb: { completed: 0, total: 2 }, attendance: { attended: 0, total: 5 }, assignments: { submitted: 0, total: 2 } },
          ],
          programme: [{ id: 'current:shared', title: 'Shared module', percent: 0 },
            { id: alex ? 'current:alex' : 'legacy:morgan', title: alex ? 'Data fundamentals' : 'Marketing strategy', percent: null }],
        } });
      }
      if (url.origin !== base || /^\/(?:[^/]+_api|api)(?:\/|$)/.test(url.pathname) || request.method() !== 'GET'
        || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__employer_module_filter') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employer module filter check</title><style>html{zoom:${zoom}}</style><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/employer-dashboard-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(base + '/__employer_module_filter');
    await expect(page.getByRole('region', { name: 'Modules', exact: true })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Shared module', exact: true })).toBeVisible();
    const sharedCard = page.getByRole('article', { name: 'Shared module', exact: true });
    await expect(sharedCard.getByText('1 Sept 2026', { exact: true })).toBeVisible();
    await expect(sharedCard.getByText('31 Dec 2026', { exact: true })).toBeVisible();
    const cardSize = await sharedCard.boundingBox();
    expect(cardSize.width / zoom).toBeLessThanOrEqual(320);
    expect(cardSize.height / zoom).toBeLessThan(310);
    const columnChart = page.getByRole('region', { name: 'Module performance', exact: true });
    await expect(columnChart.getByRole('group', { name: 'Module performance column chart', exact: true })).toBeVisible();
    await expect(columnChart.getByRole('meter')).toHaveCount(12);
    await expect(columnChart.getByRole('combobox')).toHaveCount(0);
    const sharedColumns = columnChart.getByRole('group', { name: 'Shared module', exact: true });
    await expect(sharedColumns.getByRole('meter', { name: 'Off-the-job hours' })).toHaveAttribute('aria-valuenow', '60');
    await expect(sharedColumns.getByRole('meter', { name: 'KSBs' })).toHaveAttribute('aria-valuenow', '75');
    await expect(sharedColumns.getByRole('meter', { name: 'Assignment submission' })).toHaveAttribute('aria-valuenow', '25');
    await expect(sharedColumns.getByRole('meter', { name: 'Attendance', exact: true })).toHaveAttribute('aria-valuenow', '70');
    for (const meter of await sharedColumns.getByRole('meter').all()) {
      const label = meter.locator('span[aria-hidden="true"]');
      await expect(label).toHaveCSS('color', 'rgb(255, 255, 255)');
      expect(await label.evaluate(element => getComputedStyle(element).transform)).toMatch(/^matrix\(0, -1, 1, 0,/);
      expect(await label.evaluate(element => {
        const text = element.getBoundingClientRect();
        const bar = element.parentElement.getBoundingClientRect();
        return text.left >= bar.left - 1 && text.right <= bar.right + 1 && text.top >= bar.top - 1 && text.bottom <= bar.bottom + 1;
      })).toBe(true);
    }
    const shortColumn = columnChart.getByRole('group', { name: 'Data fundamentals', exact: true }).getByRole('meter', { name: 'Off-the-job hours' });
    await expect(shortColumn).toHaveAttribute('aria-valuenow', '1');
    await expect(shortColumn.getByText('1%', { exact: true })).toBeVisible();
    await expect(shortColumn.getByText('1%', { exact: true })).toHaveCSS('transform', 'none');
    await expect(columnChart.getByRole('group', { name: 'Data fundamentals', exact: true }).getByRole('meter')).toHaveCount(4);
    await expect(columnChart.getByRole('group', { name: 'Marketing strategy', exact: true }).getByRole('meter')).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'View performance', exact: true })).toHaveCount(0);
    const charts = page.getByRole('region', { name: 'Learning performance', exact: true });
    await expect(charts.getByRole('img')).toHaveCount(0);
    await charts.getByRole('button', { name: 'Average attendance: 70%', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Average attendance', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 1440 && zoom === 1) await columnChart.screenshot({ path: join(output, 'column-labels-vertical.png') });
    await page.screenshot({ path: join(output, `${width}-overview-zoom${zoom}.png`), fullPage: true });
    if (width === 1440 && zoom === 1) {
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.screenshot({ path: join(output, '1440-overview-dark.png'), fullPage: true });
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
    }
    const overviewModule = page.getByRole('combobox', { name: 'Module', exact: true });
    const journeys = page.getByRole('region', { name: 'Progress review journey', exact: true });
    await expect(overviewModule).toBeEnabled();
    await expect(journeys.getByRole('article')).toHaveCount(2);
    await overviewModule.selectOption('legacy:morgan');
    await expect(journeys.getByRole('article', { name: 'Alex Learner reviews', exact: true })).toHaveCount(0);
    await expect(journeys.getByRole('article', { name: 'Morgan Learner reviews', exact: true })).toBeVisible();
    await expect(journeys.getByRole('link', { name: /^Morgan Learner: Review / })).toHaveCount(4);
    await expect(journeys.getByRole('link', { name: /^Morgan Learner: Review 1,/ })).toHaveAttribute('href', '/employers/8/learner/commercial/12?tab=reviews&reviewId=12-0');
    await expect(page.getByRole('region', { name: 'Module cards', exact: true }).getByRole('article')).toHaveCount(1);
    await expect(columnChart.getByRole('meter')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await journeys.screenshot({ path: join(output, `${width}-overview-module-reviews-zoom${zoom}.png`) });
    await page.getByRole('combobox', { name: 'Cohort', exact: true }).selectOption('Cohort A');
    await expect(journeys.getByRole('heading', { name: 'No matching learners', exact: true })).toBeVisible();
    await journeys.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(overviewModule).toHaveValue('');
    await expect(journeys.getByRole('article')).toHaveCount(2);
    await expect(columnChart.getByRole('meter')).toHaveCount(12);
    await page.goto(base + '/__employer_module_filter?view=learners');
    const selector = page.getByRole('combobox', { name: 'Module', exact: true });
    const table = page.getByRole('region', { name: 'Employer learners' });
    await expect(selector).toBeEnabled();
    await expect(selector.getByRole('option')).toHaveCount(4);
    await expect(table.getByRole('columnheader', { name: 'Modules', exact: true })).toHaveCount(0);
    await expect(table.getByText('1 October 2026')).toBeAttached();
    await expect(table.getByText('25 October 2027')).toBeAttached();
    await expect(table.getByRole('progressbar', { name: 'Alex Learner assessment submission' })).toHaveAttribute('aria-valuenow', '25');
    await selector.selectOption('legacy:morgan');
    await expect(page.getByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    await expect(table.getByRole('link', { name: 'View Morgan Learner' })).toBeAttached();
    await expect(table.getByRole('link', { name: 'View Alex Learner' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Learner progress overview' }).getByRole('img')).toHaveAccessibleName('On track: 0, Needs attention: 1, At risk: 0, Not available: 0');
    await expect(page.getByRole('region', { name: 'Progress review journey' }).getByRole('link', { name: 'Alex Learner', exact: true })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Cohort', exact: true }).selectOption('Cohort A');
    await expect(page.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
    await expect(selector).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    await selector.selectOption('current:shared');
    await expect(page.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
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
