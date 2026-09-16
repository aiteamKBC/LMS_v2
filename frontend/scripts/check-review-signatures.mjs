import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

// Run against local Vite. Every API, external, or non-GET request is blocked.
const base = new URL(process.env.REVIEW_SIGNATURE_CHECK_URL || 'http://127.0.0.1:3000').origin;
const output = resolve('screenshots/review-signatures');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    const blockedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base || /(?:_api\/|^\/api(?:\/|$))/.test(url.pathname) || request.method() !== 'GET') {
        blockedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort();
      }
      if (url.pathname === '/__review_signatures') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1"><title>Review signature preview</title>
        <script type="module">import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;</script></head>
        <body><div id="root"></div><script type="module" src="/scripts/review-signatures-fixture.tsx"></script></body></html>` });
      return route.continue();
    });
    await page.goto(`${base}/__review_signatures`);
    await expect(page.getByRole('button', { name: 'View signatures', exact: true })).toBeVisible({ timeout: 30000 });
    const signatures = page.getByRole('region', { name: 'Review signatures', exact: true });
    const learner = page.getByRole('article', { name: 'Learner signature', exact: true });
    const coach = page.getByRole('article', { name: 'Coach signature', exact: true });
    await expect(signatures.getByText('1 of 2 required signatures saved', { exact: true })).toBeVisible();
    await expect(learner.getByText('Sample Learner', { exact: true })).toBeVisible();
    await expect(learner.getByText('Signed 14 Sept 2026, 15:30 (Europe/London)', { exact: true })).toBeVisible();
    await expect(coach.getByText('Awaiting signature', { exact: true })).toBeVisible();
    await expect(coach.getByText('The coach still needs to sign this review.', { exact: true })).toBeVisible();
    const mark = learner.getByRole('img', { name: 'Learner signature', exact: true });
    await expect(mark).toBeVisible();
    expect(await mark.evaluate(img => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)).toBe(true);
    await expect(page.getByText('Your signature is required', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `saved-${viewport.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'View signatures', exact: true }).click();
    await expect.poll(() => page.evaluate(() => {
      const section = document.querySelector('[aria-label="Review signatures"]');
      return !!section && (document.activeElement === section || document.activeElement?.contains(section));
    })).toBe(true);
    await expect(signatures).toBeInViewport();
    // Wait for the smooth scroll to reveal the full evidence block before
    // capturing it, including the signing date at the bottom on mobile.
    await expect.poll(() => signatures.evaluate(section => section.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    expect(await page.evaluate(() => scrollY > 0)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(output, `focused-${viewport.width}.png`) });
    expect(errors).toEqual([]);
    console.log(`PASS ${viewport.width}x${viewport.height}: saved image/name/date, coach pending, summary, signature focus, no overflow; ${blockedRequests.length} requests blocked`);
    await page.close();
  }
  console.log(`Screenshots: ${output}`);
} finally { await browser.close(); }
