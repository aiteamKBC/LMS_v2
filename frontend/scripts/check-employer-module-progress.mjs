/* global document, innerWidth, getComputedStyle */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';

// Synthetic data only. No .env, authentication, backend, database or live API.
const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'employer-module-progress-'));
console.log('Screenshots: ' + output);
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import '/src/index.css';
import '/src/learner-theme.css';
import pageStyles from '/src/pages/employer/EmployerPortalPage.module.css';
import { EmployerModuleProgressTable } from '/src/pages/employer/EmployerModuleProgressTable';
const titles = ['Planning, controlling and leading projects', 'Procurement risk and contracts', 'Operations and information management', 'Advanced project management', 'Business strategy', 'Professional development'];
const learners = Array.from({ length: new URLSearchParams(window.location.search).has('single') ? 1 : 36 }, (_, index) => ({ id: String(index), kind: index % 2 ? 'commercial' : 'apprenticeship', name: 'Example Learner ' + String(index + 1).padStart(2, '0'), email: 'learner' + index + '@example.test', programme: index % 2 ? 'Marketing' : 'Project management', cohort: '', programmeStatus: 'Active', onboardingStatus: '', isActive: true, outstandingCount: 0, documentsTotal: 0 }));
const records = Object.fromEntries(learners.map((learner, index) => [learner.kind + ':' + learner.id, { status: 'ready', data: { programme: titles.flatMap((title, col) => index % 3 === 1 && col === 3 ? [] : [{ id: 'current:' + col, title, percent: index % 5 === 2 && col === 4 ? null : [0, 26, 59, 81, 100][(index + col) % 5] }]) } }]));
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/employers/8']}><div className="dashboard-theme" data-workspace-role="learner"><main className="workspace-main"><div id="employer-dashboard" className={pageStyles.page} data-employer-theme><EmployerModuleProgressTable employerId="8" learners={learners} records={records} onRetry={() => undefined} /></div></main></div></MemoryRouter>);
`;
const fixturePath = resolve(root, 'virtual-module-progress.tsx').replaceAll('\\', '/');
const server = await createServer({ configFile: false, envDir: false, root, cacheDir: join(output, 'vite-cache'),
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'react-router-dom', 'lucide-react'] }, plugins: [{
  name: 'synthetic-module-progress',
  resolveId(id) { if (id === '/virtual-module-progress.tsx') return fixturePath; },
  load(id) { if (id === fixturePath) return fixture; },
}, react()],
  resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const [width, zoom] of [[390, 1], [1440, 1], [768, 1], [320, 1], [1440, 2]]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base || request.method() !== 'GET' || /^\/(?:[^/]+_api|api)(?:\/|$)/.test(url.pathname)
        || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__employer_module_progress') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employer module progress</title><style>html{zoom:${zoom}}</style><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/virtual-module-progress.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(base + '/__employer_module_progress');
    const panel = page.getByRole('region', { name: 'Learner-by-module progress', exact: true });
    await expect(panel).toBeVisible({ timeout: 30000 });
    const table = panel.getByRole('table');
    const scroll = panel.getByRole('region', { name: 'Learner module progress table', exact: true });
    await expect(table.getByRole('rowheader')).toHaveCount(36);
    await expect(table.getByRole('columnheader')).toHaveCount(7);
    await expect(table.getByRole('link', { name: /Example Learner 01 · Planning.*: 0%/ })).toHaveText('0%');
    const progressCell = table.getByRole('link', { name: /Example Learner 01 · Planning.*: 0%/ });
    expect(await progressCell.evaluate(element => element.getBoundingClientRect().width / element.parentElement.getBoundingClientRect().width)).toBeGreaterThan(.8);
    await expect(panel.getByRole('searchbox')).toHaveCSS('border-top-width', '0px');
    await expect(table.getByText('Progress unavailable')).not.toHaveCount(0);
    await expect(table.getByText('Not enrolled')).not.toHaveCount(0);
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) {
      await page.screenshot({ path: join(output, `${width}-overflow.png`), fullPage: true });
      console.log(await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('*')].filter(element => element.scrollWidth > element.clientWidth && getComputedStyle(element).overflowX === 'visible').map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width, scroll: element.scrollWidth })).slice(0, 20) })));
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await scroll.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const headerBefore = await table.getByRole('columnheader', { name: 'Learner', exact: true }).boundingBox();
    const rowBefore = await table.getByRole('rowheader').first().boundingBox();
    await scroll.evaluate(element => { element.scrollTop = 180; element.scrollLeft = 240; });
    const headerAfter = await table.getByRole('columnheader', { name: 'Learner', exact: true }).boundingBox();
    const rowAfter = await table.getByRole('rowheader').nth(6).boundingBox();
    expect(Math.abs(headerBefore.y - headerAfter.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(rowBefore.x - rowAfter.x)).toBeLessThanOrEqual(1);
    await scroll.evaluate(element => { element.scrollTop = 0; element.scrollLeft = 0; });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      const colours = await panel.evaluate(element => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        const rgb = colour => {
          context.fillStyle = colour;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const luminance = colour => rgb(colour).map(value => {
          const channel = value / 255;
          return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
        }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
        return ['start', 'low', 'medium', 'high', 'complete'].map((tone, index) => {
          const style = getComputedStyle(element.querySelector(`[data-tone="${tone}"]`));
          const swatch = getComputedStyle(element.querySelectorAll('i[title]')[index]);
          const background = luminance(style.backgroundColor);
          const foreground = luminance(style.color);
          return { tone, background: rgb(style.backgroundColor), swatch: rgb(swatch.backgroundColor),
            contrast: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) };
        });
      });
      expect(new Set(colours.map(colour => colour.background.join(','))).size).toBe(5);
      for (const colour of colours) {
        expect(colour.contrast, `${theme} ${colour.tone} text contrast`).toBeGreaterThanOrEqual(4.5);
        expect(colour.background, `${theme} ${colour.tone} legend matches cells`).toEqual(colour.swatch);
      }
      await panel.screenshot({ path: join(output, `${width}-${theme}-zoom${zoom}.png`) });
    }
    await panel.getByRole('searchbox').fill('learner35@example.test');
    await expect(table.getByRole('rowheader')).toHaveCount(1);
    await expect(table.getByRole('link', { name: 'Example Learner 36', exact: true })).toBeVisible();
    await panel.getByRole('searchbox').fill('missing learner');
    await expect(panel.getByText('No learners match your search.')).toBeVisible();
    await panel.getByRole('button', { name: 'Clear learner search' }).click();
    await expect(table.getByRole('rowheader')).toHaveCount(36);
    if (width === 1440 && zoom === 1) {
      await page.setViewportSize({ width: 2234, height: 1000 });
      await page.goto(base + '/__employer_module_progress?single=1');
      await expect(table.getByRole('rowheader')).toHaveCount(1);
      await expect(panel.getByText('1 learner', { exact: true })).toBeVisible();
      await expect(table.getByRole('columnheader')).toHaveCount(7);
      await panel.screenshot({ path: join(output, '2234-single-learner.png') });
    }
    expect(errors).toEqual([]);
    console.log(`PASS viewport=${width}, zoom=${zoom}: 36 learners, sticky headers, scrolling, search, light/dark`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
