/* global document, innerWidth */
import { chromium, expect } from '@playwright/test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// Run with the existing local Vite server. Synthetic fixture only: no API hooks,
// every API/external/non-GET request blocked, actions only record local callbacks.
const base = new URL(process.env.REVIEWS_CHECK_URL || 'http://127.0.0.1:3000').origin;
const output = await mkdtemp(join(tmpdir(), 'reviews-ux-'));
const browser = await chromium.launch();
const results = [];
const screenshots = [];
async function capture(page, name) {
  const path = join(output, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  screenshots.push(path);
}
async function assertReflow(page, context) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    clipped: [...document.querySelectorAll('button, summary, a')].filter(element => {
      if (!element.checkVisibility()) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map(element => element.textContent.trim()),
  }));
  expect(layout.document, `${context}: document overflow`).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.clipped, `${context}: clipped controls`).toEqual([]);
}
try {
  for (const config of [
    { width: 1440, height: 1000, zoom: 1 },
    { width: 390, height: 844, zoom: 1 },
    { width: 320, height: 844, zoom: 1 },
    { width: 1440, height: 1000, zoom: 2 },
  ]) {
    const name = `${config.width}${config.zoom === 2 ? '-zoom200' : ''}`;
    const page = await browser.newPage({ viewport: { width: config.width, height: config.height } });
    const errors = [];
    const blocked = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base || /(?:_api|\/api)(?:\/|$)/.test(url.pathname) || request.method() !== 'GET'
          || ['fetch', 'xhr'].includes(request.resourceType())) {
        blocked.push({ url: request.url(), method: request.method(), type: request.resourceType() });
        return route.abort();
      }
      if (url.pathname === '/__reviews_ux') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>Reviews UI check</title>
        <style>html { zoom: ${config.zoom}; }</style>
        <script type="module">import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;</script></head>
        <body><div id="root"></div><script type="module" src="/scripts/reviews-ux-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(`${base}/__reviews_ux`);
    await expect(page.getByRole('heading', { name: 'My reviews' })).toBeVisible({ timeout: 30000 });
    const current = page.getByRole('article', { name: 'Current review' });
    await expect(current.getByRole('heading', { name: 'Progress Review #2' })).toBeVisible();
    await expect(current).toContainText('18 September 2026');
    await expect(current).not.toContainText('24 September 2026');
    await expect(current.getByRole('link', { name: 'View review', exact: true })).toHaveAttribute('href', /review-next\?kind=apprenticeship&learner=fixture-learner$/);
    await expect(page.getByRole('group', { name: 'Filter reviews' })).toHaveCount(0);
    const attention = page.getByRole('region', { name: 'Reviews needing attention' });
    await expect(attention.getByRole('heading', { name: 'Progress Review #1' })).toBeVisible();
    await expect(attention.getByRole('link', { name: 'Read & sign' })).toHaveAttribute('href', /review-signature\?/);
    await capture(page, `current-${name}`);
    await assertReflow(page, `current ${name}`);
    await current.getByText('More options', { exact: true }).click();
    await expect(current.getByRole('link', { name: 'Open meeting link' })).toHaveAttribute('href', 'https://teams.microsoft.com/example-review');
    await current.getByRole('button', { name: 'Reschedule meeting', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Fixture action' })).toHaveText('Booking opened: review-next');
    await assertReflow(page, `current options ${name}`);
    await page.getByRole('link', { name: 'View all reviews (5)', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All reviews', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'All (5)', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('listitem')).toHaveCount(5);
    await capture(page, `all-${name}`);
    await assertReflow(page, `all ${name}`);
    await page.getByRole('button', { name: 'Upcoming (2)' }).click();
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await page.getByRole('button', { name: 'Book a time' }).click();
    await expect(page.getByRole('status', { name: 'Fixture action' })).toHaveText('Booking opened: review-planned');
    await page.getByRole('button', { name: 'Past (3)' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Past (3)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Progress Review #4' })).toHaveAttribute('href', /review-completed\?.*view=all&filter=past&page=1$/);
    await page.getByRole('link', { name: 'Back to current review' }).click();
    await expect(page.getByRole('heading', { name: 'My reviews' })).toBeFocused();
    await expect(page.getByTestId('fixture-data-unchanged')).toHaveText('true');
    await page.goto(`${base}/__reviews_ux?scenario=planned`);
    await expect(page.getByRole('button', { name: 'Book a time' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'Current review' })).toContainText('24 December 2026');
    await expect(page.getByText('Target date — a meeting time has not been booked')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Join meeting' })).toHaveCount(0);
    await capture(page, `planned-${name}`);
    await assertReflow(page, `planned ${name}`);
    await page.goto(`${base}/__reviews_ux?scenario=today`);
    await expect(page.getByRole('link', { name: 'Join meeting' })).toHaveAttribute('href', 'https://teams.microsoft.com/example-review');
    await page.getByRole('button', { name: 'Attend', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Fixture action' })).toHaveText('Attendance: review-next');
    await page.getByRole('button', { name: 'Report Absence', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Fixture action' })).toHaveText('Absence: review-next');
    await assertReflow(page, `today ${name}`);
    await page.goto(`${base}/__reviews_ux?scenario=empty`);
    await expect(page.getByRole('heading', { name: 'No current review' })).toBeVisible();
    await page.getByRole('link', { name: 'View all reviews (0)', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'No reviews yet', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Book a time' })).toHaveCount(0);
    await assertReflow(page, `empty ${name}`);
    await page.goto(`${base}/__reviews_ux?scenario=completed`);
    await expect(page.getByRole('heading', { name: 'No current review' })).toBeVisible();
    await page.getByRole('link', { name: 'View all reviews (1)', exact: true }).click();
    await expect(page.getByText('Completed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Book a time' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Read & sign' })).toHaveCount(0);
    await assertReflow(page, `completed ${name}`);
    expect(errors, `runtime errors ${name}`).toEqual([]);
    expect(blocked.filter(request => request.method !== 'GET' || /(?:_api|\/api)(?:\/|$)/.test(request.url)), `API/write attempts ${name}`).toEqual([]);
    results.push({ viewport: config, runtimeErrors: errors, blockedRequests: blocked });
    console.log(`PASS ${name}: current, pending signature, all/back, filters, booking callbacks, future/today links, attendance, empty/completed, keyboard, no overflow`);
    await page.close();
  }
  await writeFile(join(output, 'results.json'), JSON.stringify({ results, screenshots }, null, 2));
  console.log(`Screenshots: ${output}`);
  console.log('200% check uses CSS zoom with responsive container reflow; it does not emulate native browser zoom controls.');
} finally {
  await browser.close();
}
