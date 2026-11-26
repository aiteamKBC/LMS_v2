import { chromium, expect } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Run against a local Vite server. Every API request is intercepted; no real
// account, booking or database is accessed by this smoke check.
const base = process.env.REVIEW_CHECK_URL || 'http://127.0.0.1:5173';
const date = '2026-09-14';
const events = [
  { title: 'Renamed coaching conversation', source: 'mcr', reviewTypeCode: 'mcm', reviewTypeName: 'Monthly Coaching Meeting' },
  { title: 'Quarterly development conversation', source: 'progress-review', reviewTypeCode: 'progress_review', reviewTypeName: 'Progress Review' },
  { title: 'Portfolio checkpoint', source: 'review', reviewTypeCode: 'portfolio', reviewTypeName: 'Portfolio Review' },
  { title: 'Leadership live workshop', source: 'live-session' },
].map((event, index) => ({
  ...event, id: `event-${index}`, eventKey: `event-${index}`, sequence: 1,
  type: event.source === 'live-session' ? 'live-session' : 'review',
  reviewTemplateId: event.reviewTypeCode ? `REV-${index}` : null,
  reviewTypeId: event.reviewTypeCode ? `REVT-${index}` : null,
  date, targetDate: date, scheduledDate: date, scheduledTime: `${10 + index}:00`,
  durationMinutes: 60, status: 'scheduled', coachName: 'Test coach',
  coachEmail: 'coach@example.test', meetingProvider: '', meetingLink: '', notes: '',
}));
const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    page.on('response', response => { if (response.status() >= 400) console.error(response.status(), response.url()); });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== base) return route.abort();
      if (url.pathname === '/__review_check') {
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <script type="module">
            import RefreshRuntime from '/@react-refresh';
            RefreshRuntime.injectIntoGlobalHook(window);
            window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
            window.__vite_plugin_react_preamble_installed__ = true;
          </script></head><body><div id="root"></div>
          <script type="module" src="/scripts/review-calendar-fixture.tsx"></script></body></html>` });
      }
      if (/_api\//.test(url.pathname)) {
        let data = { reviews: [], connections: [], busy: [] };
        if (/\/calendar\/(commercial|apprenticeship)\/\d+\/$/.test(url.pathname)) {
          data = { learner: { kind: 'commercial', id: 19 }, events };
        } else if (url.pathname.includes('/review/')) {
          data = { instance: null, occurrenceNumber: 1,
            template: { name: 'Portfolio checkpoint', sections: [], visibleTo: { participant: true } },
            sections: [], signatures: {} };
        } else if (url.pathname.includes('/coach/')) {
          data = { coachName: 'Test coach', coachEmail: 'coach@example.test' };
        }
        return route.fulfill({ json: data });
      }
      return route.continue();
    });
    await page.goto(`${base}/__review_check`);
    for (const event of events) {
      await expect(page.getByRole('button', { name: new RegExp(event.title) }).first()).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.getByTitle('Portfolio Review (1)')).toBeVisible();
    await page.getByTitle('Portfolio Review (1)').click();
    await expect(page.getByRole('button', { name: /Portfolio checkpoint/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Leadership live workshop/ })).toHaveCount(0);
    await page.screenshot({ path: join(tmpdir(), `lms-review-calendar-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: /Portfolio checkpoint/ }).first().click();
    await expect(page.getByTestId('learner-review-instance-form')).toBeVisible();
    await expect(page.getByTestId('learner-review-instance-title')).toHaveText('Portfolio checkpoint #1');
    await page.screenshot({ path: join(tmpdir(), `lms-review-form-${viewport.width}.png`), fullPage: true });
    expect(errors).toEqual([]);
    console.log(`PASS ${viewport.width}x${viewport.height}: all review types, renamed titles, live session, custom filter and form`);
    await page.close();
  }
} finally {
  await browser.close();
}
