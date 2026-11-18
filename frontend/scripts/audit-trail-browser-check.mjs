// UI-only browser regression. All APIs and external hosts are intercepted;
// this does not authenticate to, read, or mutate an LMS database.
// Start Vite on 127.0.0.1:3017, then: node scripts/audit-trail-browser-check.mjs
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3017';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const workspaces = [
  ['curriculum', 'Curriculum Studio'], ['coach', 'Coach'], ['tutor', 'Tutor'],
  ['learner', 'Learner'], ['employer', 'Employer'], ['engagement', 'Engagement'],
  ['mis', 'MIS'], ['leadership', 'Leadership'], ['qa', 'Quality Assurance'],
  ['safeguarding', 'Safeguarding'], ['support', 'Support'], ['finance', 'Finance'],
  ['enrolment', 'Enrolment'], ['record-monitor', 'Record Monitor'], ['platform', 'Platform'],
  ['admin', 'Super Admin'],
].map(([value, label]) => ({ value, label }));
const stamp = new Date().toISOString();
const actor = { email: 'audit-test@example.invalid', name: 'Audit Test Actor', role: 'super-admin',
  firstSeen: stamp, lastSeen: stamp, visits: 0, pageViews: 0, readActions: 0, changes: 1,
  signIns: 1, pagesOpened: 0, workspaces: [], lastPagePath: '', lastPageLabel: '' };
const event = { id: 'rev:1', at: stamp, action: 'updated', actionLabel: 'Edited', entity: 'module',
  entityLabel: 'Module', entityId: 'AUDIT-TEST', revisionNo: 2, title: 'Synthetic audit module',
  context: '', parents: {}, pageLabel: 'Audit test module editor', moduleCatalogueId: 'AUDIT-TEST', parentId: '', versionLabel: '',
  contentStatus: '', actorName: actor.name, actorEmail: actor.email, actorType: 'user', actorTypeLabel: 'Person',
  triggeredByEmail: '', triggeredByName: '', source: 'manual', sourceLabel: 'Manual save', reason: '',
  metadata: { page_path: '/tutor/modules/AUDIT-TEST', page_workspace: 'tutor', page_source: 'browser' },
  changes: [{ field: 'title', label: 'Title', before: 'Old module title', after: 'New module title', truncated: false }],
  snapshot: null, href: '/curriculum/modules/AUDIT-TEST' };
const base = { generatedAt: stamp, since: stamp, windowDays: 30, visitsRecorded: true,
  changesRecorded: true, signInsRecorded: true, workspaces, changeWorkspaces: workspaces.map(w => w.value),
  workspaceRecorded: true, page: 1, pages: 1, pageSize: 50, total: 1, truncated: false };
let selectedWorkspace = '';
let blockedExternal = 0;
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) { blockedExternal++; await route.abort(); return; }
  if (!/^\/(?:\w+_api|api)\//.test(url.pathname)) { await route.continue(); return; }
  let result = {};
  if (url.pathname === '/login_api/me/') result = { user: { id: 1, email: actor.email,
    displayName: actor.name, role: 'admin', subjectType: 'staff', subjectId: 1, hasPassword: true,
    lastLoginAt: stamp, permissions: ['*'], access: 'super-admin', accesses: ['super-admin'],
    accessHome: '/workspace/admin', accessNavRole: 'super-admin', accessWorkspaces: [{ access: 'super-admin', home: '/workspace/admin' }] } };
  else if (url.pathname === '/login_api/admin/audit/') result = { count: 1, page: 1, pageSize: 50,
    eventTypes: ['login'], results: [{ id: 1, event: 'login', email: actor.email, accountId: 1,
      succeeded: true, reason: null, ipAddress: '192.0.2.1', userAgent: 'Synthetic browser', createdAt: stamp, severity: 'info' }] };
  else if (url.pathname.endsWith('/activity/people/')) result = { ...base, workspace: '',
    people: [actor], roles: ['super-admin'], rolesIncludeBlank: false,
    totals: { people: 1, visits: 0, pageViews: 0, readActions: 0, changes: 1, signIns: 1 }, shown: 1, limit: 50 };
  else if (url.pathname.includes('/activity/people/')) result = { ...base, person: actor, visits: [],
    changes: [event], signIns: [], counts: { visits: 0, pageViews: 0, readActions: 0, changes: 1, changesOnAPage: 0, signIns: 1 },
    accountEventsRecorded: true, accountEvents: [{ id: 1, at: stamp, event: 'logout', succeeded: true },
      { id: 2, at: stamp, event: 'login', succeeded: true }] };
  else if (url.pathname.endsWith('/quality/audit-trail/')) {
    selectedWorkspace = url.searchParams.get('workspace') || '';
    result = { ...base, limit: 50, authorRecorded: true, source: 'revisions', structuredMetadata: true,
      actionCounts: { updated: 1 }, entityCounts: { module: 1 }, unreadable: [], actors: [], sources: [], actorTypes: [],
      entityTypes: [{ value: 'module', label: 'Module' }], events: [event] };
  } else if (url.pathname.includes('/activity/record/')) result = { recorded: 0, available: true };
  else if (url.pathname.includes('notifications')) result = { items: [], notifications: [], unreadCount: 0 };
  await route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
});

const referenceStyles = {};

async function heroAppearance(heading) {
  return heading.evaluate(element => {
    const hero = element.closest('.workspace-hero-banner');
    const tiles = [...hero.querySelectorAll('.workspace-hero-metric')];
    const pixel = color => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const heroStyle = getComputedStyle(hero);
    const titleStyle = getComputedStyle(element);
    const tileStyle = getComputedStyle(tiles[0]);
    const blend = (foreground, background) => foreground.slice(0, 3).map((channel, index) => (
      channel * foreground[3] / 255 + background[index] * (1 - foreground[3] / 255)
    ));
    const heroBackground = blend(pixel(heroStyle.backgroundColor), pixel(getComputedStyle(document.body).backgroundColor));
    return {
      style: {
        background: heroStyle.backgroundImage,
        radius: heroStyle.borderRadius,
        titleColor: titleStyle.color,
        titleSize: titleStyle.fontSize,
        titleWeight: titleStyle.fontWeight,
        descriptionColor: getComputedStyle(hero.querySelector('.workspace-hero-description')).color,
        eyebrowColor: getComputedStyle(hero.querySelector('.workspace-hero-eyebrow')).color,
        tileBackground: tileStyle.backgroundColor,
        tileColor: getComputedStyle(tiles[0].children[1]).color,
        tileRadius: tileStyle.borderRadius,
      },
      tiles: tiles.map(tile => ({
        background: pixel(getComputedStyle(tile).backgroundColor),
        renderedBackground: blend(pixel(getComputedStyle(tile).backgroundColor), heroBackground),
        value: pixel(getComputedStyle(tile.children[1].firstElementChild || tile.children[1]).color),
      })),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
}

function contrast(first, second) {
  const luminance = pixel => pixel.slice(0, 3).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

async function checkOverviewAppearance(theme, people = false) {
  await page.evaluate(value => {
    document.documentElement.dataset.theme = value;
  }, theme);
  const heading = people
    ? page.getByRole('heading', { name: 'Audit Trail', level: 2, exact: true })
    : page.getByRole('heading', { level: 1 }).filter({ hasText: /Everything happening| activity$/ });
  await heading.waitFor();
  const appearance = await heroAppearance(heading);
  if (new URL(page.url()).pathname === '/admin/audit-trail') {
    const reference = referenceStyles[`${page.viewportSize().width}:${theme}`];
    // The People section is an h2 below the page's h1; retain that hierarchy.
    const { titleSize: actualSize, ...actualStyle } = appearance.style;
    const { titleSize: referenceSize, ...referenceStyle } = reference;
    assert.deepEqual(people ? actualStyle : appearance.style, people ? referenceStyle : reference, `${theme}: match Access Logs hero styling`);
  }
  assert.equal(appearance.tiles.length, 4);
  for (const tile of appearance.tiles) {
    if (new URL(page.url()).pathname === '/admin/audit-trail') {
      assert.ok(tile.background[3] > 240, `${theme}: use shared solid metric surfaces`);
    }
    assert.ok(contrast(tile.renderedBackground, tile.value) >= 4.5, `${page.url()} (${theme}): metric values must remain readable: ${JSON.stringify(tile)}`);
  }
  assert.equal(appearance.overflow, false, `${theme}: page must fit the viewport`);
}

async function checkWorkspaceCoverage(theme) {
  await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
  const section = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Workspace coverage', exact: true }) });
  const layout = await section.evaluate(element => {
    const buttons = [...element.querySelectorAll('button')];
    const grid = buttons[0].parentElement;
    const gridBox = grid.getBoundingClientRect();
    return {
      count: buttons.length,
      clipped: grid.scrollHeight > grid.clientHeight + 1,
      contained: buttons.every(button => {
        const box = button.getBoundingClientRect();
        return box.top >= gridBox.top - 1 && box.bottom <= gridBox.bottom + 1
          && box.left >= gridBox.left - 1 && box.right <= gridBox.right + 1;
      }),
      aligned: buttons.every(button => {
        const box = button.getBoundingClientRect();
        return button.firstElementChild.getBoundingClientRect().left - box.left < 20;
      }),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  const context = `${page.viewportSize().width}px (${theme})`;
  assert.equal(layout.count, workspaces.length + 1, `${context}: render every workspace`);
  assert.equal(layout.clipped, false, `${context}: coverage must expand without an internal scrollbar`);
  assert.equal(layout.contained, true, `${context}: every card must fit fully inside the grid`);
  assert.equal(layout.aligned, true, `${context}: all card icons must align at the start`);
  assert.equal(layout.overflow, false, `${context}: coverage must fit the page width`);
}

try {
  await page.goto(`${origin}/admin/access-logs`);
  const referenceHeading = page.getByRole('heading', { name: 'Access and authentication trail', exact: true });
  await referenceHeading.waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      referenceStyles[`${width}:${theme}`] = (await heroAppearance(referenceHeading)).style;
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/admin/audit-trail`);
  await page.getByText('Synthetic audit module', { exact: true }).waitFor({ timeout: 45000 });
  await checkOverviewAppearance('light');
  for (const width of [320, 390, 768, 1024, 1440, 2249]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ['light', 'dark']) await checkWorkspaceCoverage(theme);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  const coverage = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Workspace coverage', exact: true }) });
  const tutorCard = coverage.getByRole('button', { name: /^Tutor / });
  await tutorCard.focus();
  await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/quality/audit-trail/') && url.searchParams.get('workspace') === 'tutor';
    }),
    page.keyboard.press('Enter'),
  ]);
  await page.waitForFunction(() => document.querySelector('section button[aria-pressed="true"]')?.textContent.includes('Tutor'));
  assert.equal(selectedWorkspace, 'tutor', 'keyboard selection must update the workspace request');
  await coverage.getByRole('button', { name: /^All workspaces/ }).click();
  await page.waitForFunction(() => document.querySelector('section button[aria-pressed="true"]')?.textContent.includes('All workspaces'));
  assert.equal(await tutorCard.getAttribute('aria-pressed'), 'false', 'All workspaces must clear the selection, including cached results');
  await page.screenshot({ path: 'audit-trail-browser.png', fullPage: true });
  await page.getByRole('button', { name: /Changes/ }).click();
  await page.getByText('Synthetic audit module', { exact: true }).waitFor();
  assert.equal(await page.getByText('on Audit test module editor', { exact: true }).getAttribute('title'), '/tutor/modules/AUDIT-TEST');
  await page.getByRole('combobox', { name: /Workspace/i }).click();
  await page.getByRole('option', { name: 'Tutor', exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Reading audit records...'));
  assert.equal(selectedWorkspace, 'tutor');
  const detailButton = page.getByRole('button', { name: '1 changed field', exact: true });
  await detailButton.click();
  await page.getByText('Old module title', { exact: true }).first().waitFor();
  await page.getByText('New module title', { exact: true }).first().waitFor();
  await page.goto(`${origin}/admin/audit-trail/people/${encodeURIComponent(actor.email)}`);
  await page.getByRole('button', { name: /Account access history/ }).click();
  await page.getByRole('heading', { name: 'Account access', exact: true }).waitFor();
  await page.getByText('Signed out', { exact: true }).waitFor();
  await page.getByText('Signed in', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /1 field changed/ }).click();
  await page.getByText('Old module title', { exact: true }).first().waitFor();
  for (const path of ['/admin/audit-trail', '/curriculum/audit-trail', '/coach/audit-trail']) {
    await page.goto(`${origin}${path}`);
    await page.getByText('Synthetic audit module', { exact: true }).waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) await checkOverviewAppearance(theme);
    }
    await page.getByRole('button', { name: /^People/ }).click();
    await page.getByText(actor.name, { exact: true }).first().waitFor();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const theme of ['light', 'dark']) await checkOverviewAppearance(theme, true);
    }
    const peopleHero = page.locator('.workspace-hero-banner').filter({ has: page.getByRole('heading', { name: 'Audit Trail', level: 2, exact: true }) });
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/activity/people/')),
      peopleHero.getByRole('button', { name: 'Refresh', exact: true }).click(),
    ]);
    await page.getByText(actor.name, { exact: true }).first().waitFor();
    if (path === '/admin/audit-trail') {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
      await peopleHero.screenshot({ path: 'audit-trail-people-light-browser.png' });
      await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
      await peopleHero.screenshot({ path: 'audit-trail-people-dark-browser.png' });
    }
  }
  // These older tutor heroes use the same shared surface rule with /15 tiles.
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const path of ['/tutor/sessions', '/tutor/resources', '/tutor/reports', '/tutor/quiz-results']) {
    await page.goto(`${origin}${path}`);
    const tiles = page.locator('.workspace-main div[class~="bg-white/15"]');
    await tiles.first().waitFor();
    assert.equal(await tiles.count(), 3, `${path}: three hero metrics`);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const backgrounds = await tiles.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
      for (const background of backgrounds) {
        assert.match(background, /^rgba\(255, 255, 255, 0\.15\)$/, `${path} (${theme}): preserve glass metrics`);
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', checks: ['workspace coverage: 16 workspaces, 320–2249px, light/dark, no clipping/inner scroll, aligned cards, keyboard selection/reset', 'workspace filter', 'source page', 'before/after', 'person history', 'login/logout', 'Access Logs style parity: light/dark, desktop/mobile', 'People hero: readable description/eyebrow, shared metric styling, Refresh revalidation', 'metric contrast: admin/curriculum/coach, both tabs, light/dark, desktop/mobile', 'shared translucent metrics: tutor sessions/resources/reports/quiz-results, light/dark'], blockedExternal, backend: 'mocked; no database access' }));
} finally {
  await browser.close();
}
