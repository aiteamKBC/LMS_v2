/* global console, URL, document, getComputedStyle, innerWidth */
// node scripts/check-workspace-colours.mjs
// No .env, backend, authentication, external requests or live account data.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const output = await mkdtemp(join(tmpdir(), 'workspace-colours-'));
console.log(`Screenshots: ${output}`);
const server = await createServer({ root, configFile: false, envDir: false,
  cacheDir: join(output, 'vite-cache'), plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: '127.0.0.1', port: 0, hmr: false, proxy: {} } });
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === base && request.method() === 'GET' && /^\/learner_api\/employer-portal\/8\/learner\/(apprenticeship|commercial)\/\d+\/overview\/dashboard\/$/.test(url.pathname)) {
      return route.fulfill({ json: {
        metrics: { otjh: { actual: 40, targetToDate: 100 }, ksb: { completed: 2, total: 4, percent: 50 } },
        reviews: { completed: 1, total: 2, percent: 50 }, hours: { months: [] },
        modules: [{ id: 'current:101', title: 'Professional development', start: '', end: '', activities: { completed: 3, total: 5 }, assignments: { submitted: 1, total: 2 }, attendance: { attended: 4, total: 5 }, hours: { actual: 20, planned: 50 }, ksb: { completed: 2, total: 4 } }],
        programme: [{ id: 'current:101', title: 'Professional development', percent: 60 }],
      } });
    }
    if (url.origin !== base || request.method() !== 'GET' || /^\/(?:[^/]+_api|api)\//.test(url.pathname)) return route.abort();
    if (url.pathname === '/__employer-palette') return route.fulfill({ contentType: 'text/html', body:
      await server.transformIndexHtml('/__employer-palette', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">import "/src/components/feature/WorkspaceColourTheme.css"; import "/scripts/employer-dashboard-fixture.tsx";</script></body></html>') });
    if (url.pathname === '/__palette') return route.fulfill({ contentType: 'text/html', body:
      await server.transformIndexHtml('/__palette', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/workspace-colours-fixture.tsx"></script></body></html>') });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let passed = 0;
  for (const role of ['learner', 'coach', 'tutor', 'employer', 'admin', 'curriculum', 'auditor', 'mis', 'qa', 'finance', 'engagement', 'support', 'safeguarding', 'leadership']) {
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/__palette?role=${role}`, { waitUntil: 'networkidle' });
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.getByRole('heading', { name: 'A little progress, every day' }).waitFor();
      const colors = await page.evaluate(() => {
        const style = selector => getComputedStyle(document.querySelector(selector));
        return {
          title: style('.workspace-hero-title').color,
          hero: style('.workspace-hero-banner').backgroundImage,
          cards: [...document.querySelectorAll('[data-neutral-metrics] .ui-metric-card')].map(el => getComputedStyle(el).backgroundImage),
          positive: style('[data-metric-tone="positive"] .workspace-metric-icon').color,
          critical: style('[data-metric-tone="critical"] .workspace-metric-icon').color,
          canvas: getComputedStyle(document.documentElement).getPropertyValue('--workspace-colour-canvas').trim(),
        };
      });
      assert.equal(colors.title, 'rgb(255, 255, 255)', `${role}/${theme}: readable hero title`);
      assert(colors.hero.includes('gradient'), `${role}/${theme}: hero gradient`);
      assert.equal(new Set(colors.cards).size, 4, `${role}/${theme}: four distinct neutral accents`);
      assert.notEqual(colors.positive, colors.critical, `${role}/${theme}: status colours stay distinct`);
      assert.equal(colors.canvas, theme === 'dark' ? '#181622' : '#f5f4fb');
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${role}/${theme}/${width}: no overflow`);
        if (['learner', 'coach', 'employer', 'curriculum'].includes(role)) await page.screenshot({ path: join(output, `${role}-${theme}-${width}.png`), fullPage: true });
      }
      passed++;
    }
  }
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/__employer-palette`, { waitUntil: 'networkidle' });
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.getByRole('heading', { name: 'Example employer' }).waitFor();
      const fills = await page.getByRole('region', { name: 'Learning performance' }).locator(':scope > button').evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundImage));
      assert.equal(new Set(fills).size, 5, `Employer KPIs: five distinct accents ${theme}/${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `Employer ${theme}/${width}: no overflow`);
      await page.screenshot({ path: join(output, `employer-dashboard-${theme}-${width}.png`), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${passed} role/theme checks, desktop and mobile; 4 employer dashboard checks. Screenshots: ${output}`);
} finally { await browser?.close(); await server.close(); }
