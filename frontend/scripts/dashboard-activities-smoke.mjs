// Isolated visual check; all API and external requests are blocked.
import { chromium, expect } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const name = `dashboard-activities-preview-${process.pid}.tsx`;
const filename = join(frontend, name);
await writeFile(filename, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import './src/index.css'; import './src/learner-theme.css';
import { DashboardActivities } from './src/pages/workspace/learner/DashboardActivities';
function Preview() {
  const { pathname } = useLocation();
  return <div className="dashboard-theme" data-workspace-role="learner"><main className="workspace-main" style={{ maxWidth: 1460, margin: 'auto', padding: 16 }}>
    <h1 style={{ fontSize: 24, margin: '16px 0 24px' }}>Dashboard</h1>
    <DashboardActivities kind="apprenticeship" programmeStatus="Active" canSeeNavItem={() => true} />
    <output data-testid="destination" style={{ display: 'none' }}>{pathname}</output>
  </main></div>;
} createRoot(document.getElementById('root')!).render(<MemoryRouter><Preview /></MemoryRouter>);`);
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || /_api\/|\/api\//.test(url.pathname)) return route.abort();
    if (url.pathname === '/__dashboard-activities') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/${name}"></script></body></html>` });
    return route.continue();
  });
  await page.goto(`${process.env.TIMELINE_SMOKE_URL || 'http://127.0.0.1:3000'}/__dashboard-activities`);
  const region = page.getByRole('region', { name: 'Activities & rewards' });
  await expect(region).toBeVisible();
  const screenshots = [];
  for (const width of [1600, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No page overflow at ${width}`);
    await expect(region.getByRole('link')).toHaveCount(4);
    assert(await region.getByRole('link').evaluateAll(links => links.every(link => link.scrollWidth <= link.clientWidth)), `Link descriptions fit at ${width}`);
    const path = join(tmpdir(), `dashboard-activities-${width}.png`);
    await page.screenshot({ path, animations: 'disabled' }); screenshots.push(path);
  }
  for (const [label, destination] of [['Clubs & meetings', '/learner/clubs'], ['Events & bookings', '/learner/clubs/events'], ['Points & rewards', '/learner/rewards'], ['Flash cards', '/learner/flash-cards']]) {
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page.getByTestId('destination')).toHaveText(destination);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots }));
} finally {
  await browser?.close();
  await unlink(filename);
}
