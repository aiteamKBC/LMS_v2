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
  resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const [width, zoom] of [[1672, 1], [1440, 1], [1100, 1], [768, 1], [390, 1], [320, 1], [1440, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      // Synthetic module projections only; all other API calls remain blocked.
      if (url.origin === base && request.method() === 'GET' && /^\/learner_api\/employer-portal\/8\/learner\/(apprenticeship|commercial)\/\d+\/overview\/dashboard\/$/.test(url.pathname)) {
        const missing = page.url().includes('scenario=missing');
        const manyModules = page.url().includes('scenario=many-modules');
        const alex = url.pathname.includes('/11/');
        return route.fulfill({ json: { metrics: { otjh: { actual: alex ? 90 : 70, targetToDate: 100 }, ksb: { completed: 2, total: 4, percent: 50 } }, reviews: { completed: 1, total: 2, percent: 50 }, modules: missing ? [] : [{ id: 'current:101', title: 'Professional development', start: '', end: '', activities: { completed: 3, total: 5 }, assignments: { submitted: alex ? 1 : 2, total: 2 }, attendance: { attended: alex ? 4 : 3, total: 5 }, hours: { actual: alex ? 30 : 20, planned: 50 }, ksb: { completed: 2, total: 4 } }], hours: { months: [] },
          programme: manyModules ? Array.from({ length: 10 }, (_, index) => ({ id: `current:${index + 201}`, title: `Module ${String(index + 1).padStart(2, '0')} — Professional development`, percent: index * 10 })) : [{ id: 'current:101', title: 'Professional development', percent: missing ? null : alex ? 80 : 40 },
            { id: alex ? 'current:102' : 'current:103', title: alex ? 'Data fundamentals' : 'Marketing strategy', percent: missing ? null : alex ? 68 : 32 }] } });
      }
      if (url.origin !== base || /^\/(?:[^/]+_api|api)(?:\/|$)/.test(url.pathname) || request.method() !== 'GET'
          || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__employer_dashboard') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employer dashboard check</title><style>html{zoom:${zoom}}</style><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/employer-dashboard-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(base + '/__employer_dashboard' + (width === 1672 ? '?sidebar=true' : ''));
    await expect(page.getByRole('heading', { name: 'Example employer' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Professional development average module progress' })).toHaveAttribute('aria-valuenow', '60');
    await expect(page.getByRole('region', { name: 'Employer learners' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Learner progress overview' })).toHaveCount(0);
    const layout = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    await page.screenshot({ path: join(output, width + '-zoom' + zoom + '.png'), fullPage: true });
    expect(layout.document, 'Page width at ' + width + '/' + zoom).toBeLessThanOrEqual(layout.viewport + 1);
    await page.getByRole('combobox', { name: 'Programme', exact: true }).selectOption('Data Analysis');
    await expect(page.getByRole('progressbar', { name: 'Professional development average module progress' })).toHaveAttribute('aria-valuenow', '80');
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Professional development average module progress' })).toHaveAttribute('aria-valuenow', '60');
    await page.getByRole('searchbox', { name: 'Search learners', exact: true }).fill('No matching learner');
    await expect(page.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    expect(errors).toEqual([]);
    await page.goto(base + '/__employer_dashboard?scenario=many-modules');
    const carousel = page.getByRole('region', { name: 'Module cards', exact: true });
    await expect(carousel.getByRole('article')).toHaveCount(10);
    const previous = page.getByRole('button', { name: 'Previous modules', exact: true });
    const next = page.getByRole('button', { name: 'Next modules', exact: true });
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();
    const cards = await carousel.getByRole('article').evaluateAll(elements => elements.map(element => {
      const rect = element.getBoundingClientRect(); return { top: rect.top, width: rect.width };
    }));
    expect(cards.every(card => Math.abs(card.top - cards[0].top) < 1), 'Modules stay in one row').toBe(true);
    expect(cards[0].width, 'Cards keep a readable width').toBeGreaterThan(width <= 390 ? 200 : 260);
    await next.click();
    await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
    await expect(previous).toBeEnabled();
    await carousel.focus();
    await page.keyboard.press('End');
    await expect(next).toBeDisabled();
    await page.keyboard.press('Home');
    await expect(previous).toBeDisabled();
    await page.keyboard.press('ArrowRight');
    await expect(previous).toBeEnabled();
    // Filtering after scrolling must return to the first matching card.
    await page.getByRole('searchbox', { name: 'Search learners', exact: true }).fill('no such learner');
    await expect(page.getByRole('heading', { name: 'No matching learners' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(previous).toBeDisabled();
    if (width === 390 && zoom === 1) {
      await carousel.scrollIntoViewIfNeeded();
      const box = await carousel.boundingBox();
      const cdp = await page.context().newCDPSession(page);
      const start = box.x + box.width - 25;
      const end = box.x + 30;
      const y = box.y + 120;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
      for (let step = 1; step <= 8; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (end - start) * step / 8, y }] });
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await expect.poll(() => carousel.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
      await cdp.detach();
      await carousel.focus();
      await page.keyboard.press('Home');
      await expect(previous).toBeDisabled();
    }
    await carousel.evaluate(element => element.blur());
    await page.screenshot({ path: join(output, width + '-modules-swipe-zoom' + zoom + '.png'), fullPage: true });
    await page.getByRole('region', { name: 'Modules', exact: true }).screenshot({ path: join(output, width + '-modules-section-zoom' + zoom + '.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
    await page.goto(base + '/__employer_dashboard?view=learners');
    await expect(page.getByRole('heading', { name: 'My learners', exact: true })).toBeVisible();
    const learnerTable = page.getByRole('region', { name: 'Employer learners' });
    for (const name of ['Start date', 'End date', 'Assessment']) await expect(learnerTable.getByRole('columnheader', { name, exact: true })).toBeAttached();
    await expect(learnerTable.getByRole('columnheader', { name: 'Modules', exact: true })).toHaveCount(0);
    await expect(learnerTable.getByText('1 October 2026')).toBeAttached();
    await expect(learnerTable.getByText('25 October 2027')).toBeAttached();
    await expect(learnerTable.getByRole('progressbar', { name: 'Alex Learner assessment submission' })).toHaveAttribute('aria-valuenow', '50');
    const moduleFilter = page.getByRole('combobox', { name: 'Module', exact: true });
    await expect(moduleFilter).toBeEnabled();
    await moduleFilter.selectOption('current:103');
    await expect(page.getByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    await expect(learnerTable.getByRole('link', { name: 'View Morgan Learner' })).toBeAttached();
    await expect(learnerTable.getByRole('link', { name: 'View Alex Learner' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(moduleFilter).toHaveValue('');
    await expect(page.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    await learnerTable.evaluate(element => { element.scrollLeft = 0; });
    await expect(page.getByRole('region', { name: 'Learner progress overview' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Progress', exact: true }).selectOption('need-attention');
    await page.getByRole('combobox', { name: 'Cohort', exact: true }).selectOption('October 2026');
    await expect(page.getByRole('heading', { name: 'Your learners (1)' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your learners (2)' })).toBeVisible();
    const learnerWidth = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(learnerWidth.document, 'My learners width at ' + width + '/' + zoom).toBeLessThanOrEqual(learnerWidth.viewport + 1);
    await page.screenshot({ path: join(output, width + '-learners-zoom' + zoom + '.png'), fullPage: true });
    if (width === 1440 && zoom === 1) {
      await page.goto(base + '/__employer_dashboard?scenario=empty');
      await expect(page.getByRole('heading', { name: 'No learners linked yet' })).toBeVisible();
      await page.goto(base + '/__employer_dashboard?scenario=missing');
      await expect(page.getByRole('progressbar')).toHaveCount(0);
      await page.goto(base + '/__employer_dashboard?view=learners&scenario=many');
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

