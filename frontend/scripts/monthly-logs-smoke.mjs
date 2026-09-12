// Isolated browser check: every API and external request is intercepted.
import { chromium } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let role = 'learner';
const logRequests = [];
const signature = { signed_at: '2026-09-01', signer_name: 'Alex Smith',
  url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==' };
const current = { source: 'lms', month: '2026-09', status: 'awaiting_signature', row_count: 1,
  planned_hours: 2, actual_hours: 1, not_accepted_hours: 0, total_actual_hours: 1, pending_revisions: 0,
  can_complete: false, source_finalization: null, student_signature: null, coach_signature: null, snapshot_digest: 'reviewed-digest',
  rows: [{ id: 44, title: 'Business strategy reading', category: 'Reading', activity_date: '2026-09-12',
    activity_time: '10:00', timestamp_label: '10:00', planned_hours: 2, actual_hours: 1, accepted: true,
    completion_note: 'Applied the strategic framework to a workplace project.', ksb_codes: ['K1', 'S2'], documents: [], results: [] }] };
const retained = { ...current, source: 'legacy', month: '2026-08', status: 'complete', student_signature: signature, coach_signature: signature };
const summary = { learner: { id: 12, aptem_id: 42, name: 'Alex Smith', programme: 'Business Management', coach_name: 'Sam Taylor' },
  months: [retained, current], total_months: 2, completed_months: 1, read_only: false, csrf_token: 'mock-csrf' };

await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
  if (!url.pathname.includes('_api/') && !url.pathname.startsWith('/api/')) return route.continue();
  let body = { results: [], count: 0 };
  if (url.pathname === '/login_api/me/') body = { user: { id: 1, email: `${role}@example.test`, displayName: role === 'learner' ? 'Alex Smith' : 'Sam Taylor',
    role, subjectType: role === 'learner' ? 'learner' : 'staff', subjectId: role === 'learner' ? 12 : 99, access: role === 'learner' ? 'learner' : role === 'admin' ? 'super-admin' : 'coach',
    accesses: role === 'learner' ? [] : [role === 'admin' ? 'super-admin' : 'coach'], learnerType: 'apprenticeship', hasPassword: true, permissions: [], hasLegacyRecord: false } };
  else if (url.pathname.includes('/monthly-logs/')) {
    logRequests.push(url.pathname + url.search);
    if (url.pathname.endsWith('/learners/')) body = { learners: [summary.learner] };
    else if (url.pathname.includes('/activities/')) body = { id: 44, parts: [{ id: 44, title: 'Original learning material', category: 'Reading', url: null, html: '<h1>Business strategy</h1><p>The original learning material appears inside the report.</p>', quiz: null }] };
    else if (url.pathname.endsWith('/2026-09/sign/')) {
      assert(route.request().postDataBuffer().includes(Buffer.from('reviewed-digest')));
      if (role === 'learner') { current.student_signature = signature; current.status = 'complete'; }
      else current.coach_signature = signature;
      body = current;
    } else if (url.pathname.includes('/2026-09/')) body = current;
    else if (url.pathname.includes('/2026-08/')) body = retained;
    else body = { ...summary, read_only: role !== 'learner' && url.searchParams.get('perspective') === 'learner' };
  } else if (/learner-(summary|detail)/.test(url.pathname)) body = { id: '12', name: 'Alex Smith', learnerType: 'apprenticeship',
    programmeStatus: 'Active', status: 'Active', programme: 'Business Management', isActive: true, modules: [], components: [], activityFeed: [], photo: null };
  else if (url.pathname.includes('/profile-photo/')) body = { url: null };
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const root = process.env.MONTHLY_LOGS_SMOKE_URL || 'http://127.0.0.1:3000';
try {
  await page.goto(`${root}/learner/monthly-logs`);
  await page.getByRole('heading', { name: 'September 2026' }).waitFor({ timeout: 60000 });
  assert.equal(await page.getByRole('link', { name: 'Monthly Cycle', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Monthly submission', exact: true }).count(), 0);
  const monthCards = page.locator('article');
  assert.equal(await monthCards.count(), 2);
  const firstCard = await monthCards.nth(0).boundingBox();
  const secondCard = await monthCards.nth(1).boundingBox();
  assert(secondCard.y >= firstCard.y + firstCard.height, 'Months are stacked vertically.');
  assert.equal(await monthCards.nth(0).getByRole('heading').innerText(), 'August 2026');
  await page.screenshot({ path: join(tmpdir(), 'monthly-logs-months.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Review month', exact: false }).first().click();
  await page.getByRole('table', { name: 'Monthly activity log' }).waitFor();
  await page.getByRole('img', { name: 'Learner signature', exact: true }).waitFor();
  await page.getByRole('img', { name: 'Coach signature', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Business strategy reading' }).click();
  await page.locator('iframe').first().waitFor();
  assert.equal(await page.locator('iframe').count() > 0, true, 'Reading uses the existing iframe preview.');
  await page.screenshot({ path: join(tmpdir(), 'monthly-logs-report.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Close Business strategy reading' }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.getByRole('button', { name: 'Sign as learner', exact: true }).click();
  const canvas = page.getByLabel('Draw your signature');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 30, { steps: 8 });
  await page.mouse.move(box.x + 140, box.y + 100, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Confirm and save signature' }).click();
  await page.getByText('Your signature has been saved for this month.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(tmpdir(), 'monthly-logs-mobile.png'), fullPage: true, animations: 'disabled' });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  role = 'admin';
  const previewStart = logRequests.length;
  // The admin's subject id is 99; the learner selected in this workspace is 12.
  await page.goto(`${root}/learner/monthly-logs`);
  await page.getByRole('heading', { name: 'August 2026' }).waitFor();
  assert.equal(await page.locator('.workspace-shell').getAttribute('data-workspace-role'), 'learner');
  assert.equal(await page.getByRole('textbox', { name: 'Search learners' }).count(), 0);
  await page.getByRole('link', { name: 'Review month', exact: false }).first().click();
  await page.getByRole('img', { name: 'Learner signature', exact: true }).waitFor();
  assert(page.url().endsWith('/learner/monthly-logs/apprenticeship/12/2026-08'));
  await page.getByRole('button', { name: 'Business strategy reading' }).click();
  await page.locator('iframe').first().waitFor();
  await page.getByRole('button', { name: 'Close Business strategy reading' }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#monthly-log-month')?.value === '2026-09');
  await page.getByText('You are viewing this learner’s record. Each person signs from their own account.').waitFor();
  assert.equal(await page.getByRole('button', { name: /^Sign as/ }).count(), 0);
  assert(logRequests.slice(previewStart).every(url => url.includes('/12/') && url.includes('perspective=learner')));
  await page.screenshot({ path: join(tmpdir(), 'monthly-logs-learner-preview.png'), fullPage: true, animations: 'disabled' });
  role = 'staff';
  await page.goto(`${root}/coach/monthly-logs/12/2026-09`);
  await page.getByRole('table', { name: 'Report sign-off' }).waitFor();
  await page.getByRole('button', { name: 'Sign as coach', exact: true }).click();
  await page.getByRole('heading', { name: 'Coach signature', exact: true }).waitFor();
  assert.equal(await page.locator('.workspace-shell').getAttribute('data-workspace-role'), 'coach');
  // Check a longer journal across years at desktop, tablet and phone sizes.
  summary.months = [
    ...['2024-10', '2024-11', '2024-12', '2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07'].map(month => ({ ...retained, month })),
    retained, { ...current, student_signature: null, status: 'awaiting_signature' },
  ];
  role = 'learner';
  await page.goto(`${root}/learner/monthly-logs`);
  await page.getByRole('heading', { name: 'October 2024' }).waitFor();
  for (const width of [1600, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.workspace-main').evaluate(node => { node.scrollTop = 0; });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `No page overflow at ${width}px`);
    assert.equal(await page.locator('.workspace-main').evaluate(node => node.scrollWidth > node.clientWidth + 1), false, `No workspace overflow at ${width}px`);
    await page.screenshot({ path: join(tmpdir(), `monthly-logs-index-${width}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: /Awaiting signature/ }).click();
  assert.equal(await page.locator('article').count(), 1);
  await page.getByRole('combobox', { name: 'Filter by year' }).selectOption('2025');
  await page.getByRole('heading', { name: 'All signatures saved for 2025' }).waitFor();
  await page.getByRole('button', { name: 'View all months' }).click();
  assert.equal(await page.locator('article').count(), 7);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots: ['months', 'report', 'mobile', 'learner-preview'].map(name => join(tmpdir(), `monthly-logs-${name}.png`)) }));
} finally {
  await browser.close();
}
