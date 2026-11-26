// Offline browser smoke: run Vite on port 3000 first. Every API call is mocked.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const executablePath = [
  chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
assert(executablePath, 'A local Chromium browser is required for the layout smoke test');
const origin = process.env.COACHING_MEETINGS_SMOKE_URL || 'http://127.0.0.1:3000';

const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
await page.clock.setFixedTime(new Date('2026-09-14T10:00:00Z'));

const base = {
  type: 'coaching', source: 'mcr', durationMinutes: 60, platform: 'Microsoft Teams',
};
const activeMeetings = [
  { ...base, id: 'mcr-1', eventKey: 'mcr:1', title: 'Monthly coaching meeting 1', status: 'not-scheduled',
    learner: 'A learner with an exceptionally long name that must remain contained inside the card', targetDate: '2026-09-01',
    group: 'A very long group name that should truncate without widening the meeting card' },
  { ...base, id: 'mcr-2', eventKey: 'mcr:2', title: 'Monthly coaching meeting 2', status: 'scheduled', learner: 'Scheduled Learner',
    targetDate: '2026-09-22', scheduledDate: '2026-09-22', scheduledTime: '10:30', meetingLink: 'https://teams.example/meeting-2', group: 'Group 2' },
  { ...base, id: 'mcr-3', eventKey: 'mcr:3', title: 'Monthly coaching meeting 3', status: 'in-progress', learner: 'In Progress Learner',
    targetDate: '2026-09-23', scheduledDate: '2026-09-23', scheduledTime: '11:00', meetingLink: 'https://teams.example/meeting-3',
    cohort: 'A very long cohort name that remains available without overflowing the card' },
  { ...base, id: 'mcr-4', eventKey: 'mcr:4', title: 'Monthly coaching meeting 4', status: 'not-scheduled', learner: 'Not Scheduled Learner',
    targetDate: '2026-09-30', group: 'Group 4' },
];
const completedMeeting = {
  ...base, id: 'mcr-5', eventKey: 'mcr:5', title: 'Monthly coaching meeting 5', status: 'completed', learner: 'Completed Learner',
  targetDate: '2026-09-10', scheduledDate: '2026-09-10', scheduledTime: '09:00', group: 'Group 5',
};

let activeCount = 4;
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(error.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
  if (!/^\/(?:[^/]*_api|api)\//.test(url.pathname)) return route.continue();

  let json = { results: [], count: 0 };
  if (url.pathname === '/login_api/me/') {
    json = { user: { id: 99, email: 'coach@example.test', displayName: 'Coach Example', role: 'staff', access: 'coach', accesses: ['coach'],
      subjectType: 'staff', subjectId: 99, hasPassword: true, permissions: [], hasLegacyRecord: false } };
  } else if (url.pathname === '/coach_api/coach/timetable') {
    json = { owner: { name: 'Coach Example', email: 'coach@example.test' }, events: [...activeMeetings.slice(0, activeCount), completedMeeting] };
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
});

async function openMeetings() {
  await page.goto(`${origin}/coach/meetings`);
  await page.waitForTimeout(1000);
  if (await page.getByTestId('coaching-meeting-grid').count() === 0) {
    console.error(JSON.stringify({ body: await page.locator('body').textContent(), runtimeErrors }, null, 2));
  }
  await expect(page.getByTestId('coaching-meeting-grid')).toBeVisible({ timeout: 30000 });
}

async function assertNoOverflow(width) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1),
    false,
    `Page has no horizontal overflow at ${width}px`,
  );
  const cards = page.getByTestId('coaching-meeting-grid').locator('.ui-action-row');
  assert.equal(
    await cards.evaluateAll(items => items.some(item => item.scrollWidth > item.clientWidth + 1)),
    false,
    `Meeting cards have no horizontal overflow at ${width}px`,
  );
  await expect(page.getByRole('button', { name: 'Calendar', exact: true })).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Join Meeting', exact: true })).toHaveCount(2);
}

try {
  await openMeetings();

  // The real page data path is reloaded for one through four current-month cards.
  for (const count of [1, 2, 3, 4]) {
    activeCount = count;
    await page.reload();
    await expect(page.getByTestId('coaching-meeting-grid').locator('.ui-action-row')).toHaveCount(count);
  }

  activeCount = 4;
  await page.reload();
  await expect(page.getByTestId('coaching-meeting-grid').locator('.ui-action-row')).toHaveCount(4);

  // Scheduled/in-progress meetings retain Join + Manage; unscheduled retains Schedule.
  const overdue = page.locator('.ui-action-row').filter({ hasText: activeMeetings[0].learner });
  await expect(overdue.getByText('Overdue', { exact: true })).toBeVisible();
  await expect(overdue.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible();
  const scheduled = page.locator('.ui-action-row').filter({ hasText: 'Scheduled Learner' });
  await expect(scheduled.getByRole('button', { name: 'Join Meeting', exact: true })).toBeVisible();
  await expect(scheduled.getByRole('button', { name: 'Manage', exact: true })).toBeVisible();
  const inProgress = page.locator('.ui-action-row').filter({ hasText: 'In Progress Learner' });
  await expect(inProgress.getByRole('button', { name: 'Join Meeting', exact: true })).toBeVisible();
  await expect(inProgress.getByRole('button', { name: 'Manage', exact: true })).toBeVisible();

  for (const width of [1600, 1280, 1024, 768, 390, 320]) await assertNoOverflow(width);

  // Wide desktop is two columns; at laptop/tablet widths cards deliberately stack.
  await page.setViewportSize({ width: 1600, height: 1000 });
  const cards = page.getByTestId('coaching-meeting-grid').locator('.ui-action-row');
  const desktopBoxes = await cards.evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()));
  assert.equal(Math.round(desktopBoxes[0].top), Math.round(desktopBoxes[1].top), 'Desktop cards form a two-column row');
  assert(desktopBoxes[2].top > desktopBoxes[0].bottom, 'The second desktop row follows the first');

  activeCount = 3;
  await page.reload();
  const oddGrid = page.getByTestId('coaching-meeting-grid');
  await expect(oddGrid.locator('.ui-action-row')).toHaveCount(3);
  const gridBox = await oddGrid.boundingBox();
  const lastBox = await oddGrid.locator('.ui-action-row').last().boundingBox();
  assert(gridBox && lastBox && Math.abs(gridBox.width - lastBox.width) <= 2, 'The odd final card spans the full desktop row');

  activeCount = 4;
  await page.reload();
  await expect(page.getByTestId('coaching-meeting-grid').locator('.ui-action-row')).toHaveCount(4);
  await page.setViewportSize({ width: 1024, height: 1000 });
  const laptopBoxes = await page.getByTestId('coaching-meeting-grid').locator('.ui-action-row').evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()));
  assert(laptopBoxes[1].top > laptopBoxes[0].bottom, 'Laptop cards use one column');

  // Completed is still driven by the existing tab/status filtering logic.
  await page.getByRole('button', { name: /^Completed/ }).click();
  await expect(page.getByText('Completed Learner', { exact: true })).toBeVisible();
  await expect(page.getByText('Completed', { exact: true }).last()).toBeVisible();

  assert.deepEqual(runtimeErrors, [], 'No browser runtime errors');
  console.log(JSON.stringify({ passed: true, counts: [1, 2, 3, 4], widths: [1600, 1280, 1024, 768, 390, 320] }));
} finally {
  await browser.close();
}
