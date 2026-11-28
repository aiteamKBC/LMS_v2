import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run with local Vite. The fixture has no API hooks, and every API request is blocked.
const base = process.env.COACHING_CHECK_URL || 'http://127.0.0.1:3000';
const output = resolve('screenshots/coaching-ux');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== base || /_api\//.test(url.pathname) || route.request().method() !== 'GET') return route.abort();
      if (url.pathname === '/__coaching_ux') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>Coaching UI check</title>
        <script type="module">import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;</script></head>
        <body><div id="root"></div><script type="module" src="/scripts/coaching-ux-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(`${base}/__coaching_ux`);
    await expect(page.getByRole('heading', { name: 'My coaching' })).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('link', { name: 'Review & sign' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Prepare for meeting' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open meeting link' })).toHaveAttribute('href', 'https://teams.microsoft.com/example');
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.screenshot({ path: resolve(output, `current-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByText('More options', { exact: true }).click();
    await page.getByRole('button', { name: 'Reschedule', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Booking opened: next');
    await page.getByRole('link', { name: 'View all meetings', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All coaching meetings' })).toBeFocused();
    await expect(page.getByRole('tab', { name: /Upcoming/ })).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: resolve(output, `all-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Book a time' }).click();
    await expect(page.getByRole('status')).toHaveText('Booking opened: planned');
    await page.getByRole('tab', { name: /Needs your action/ }).click();
    await expect(page.getByRole('link', { name: 'Review & sign' })).toBeVisible();
    await page.getByRole('tab', { name: /Needs your action/ }).press('End');
    await expect(page.getByRole('tab', { name: /Past/ })).toBeFocused();
    await expect(page.getByRole('link', { name: 'View summary', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Back to current meeting' }).click();
    await expect(page.getByRole('heading', { name: 'My coaching' })).toBeFocused();
    await page.goto(`${base}/__coaching_ux?scenario=today`);
    await expect(page.getByRole('link', { name: 'Join meeting' })).toHaveAttribute('href', 'https://teams.microsoft.com/example');
    await page.goto(`${base}/__coaching_ux?scenario=absence`);
    await expect(page.getByText('Test curriculum', { exact: true })).toBeVisible();
    await expect(page.getByText('This meeting is booked with Rewan Yasser.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reschedule meeting' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open meeting link' })).toHaveAttribute('href', 'https://teams.microsoft.com/example');
    await page.screenshot({ path: resolve(output, `absence-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    console.log(`PASS ${viewport.width}x${viewport.height}: current coach, booking host, future/absence links, archive, booking, keyboard, no overflow`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
