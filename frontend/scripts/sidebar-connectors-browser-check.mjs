// Run: node scripts/sidebar-connectors-browser-check.mjs
// Starts an isolated frontend with no API proxy. Every API and external request
// is intercepted, so this check never connects to an LMS database or live service.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const origin = 'http://127.0.0.1:3019';
const screenshots = process.env.SIDEBAR_SCREENSHOTS_DIR;
const server = await createServer({
  root,
  configFile: resolve(root, 'vite.config.ts'),
  plugins: [{ name: 'isolated-sidebar-preview', configResolved(config) { config.server.proxy = {}; } }],
  server: { host: '127.0.0.1', port: 3019, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!/^\/(?:\w+_api|api)\//.test(url.pathname)) return route.continue();
    let data = { results: [], permissions: [], count: 0 };
    if (url.pathname === '/login_api/me/') data = { user: {
      id: 7, email: 'sidebar-preview@example.invalid', displayName: 'Sidebar Preview',
      role: 'admin', subjectType: 'staff', subjectId: 7, hasPassword: true, permissions: ['*'],
      access: 'super-admin', accesses: ['super-admin'], accessHome: '/workspace/admin',
      accessNavRole: 'super-admin', accessWorkspaces: [{ access: 'super-admin', home: '/workspace/admin' }],
    } };
    else if (url.pathname.includes('notifications')) data = { items: [], notifications: [], unreadCount: 0 };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  const geometry = active => active.evaluate(element => {
    const fill = element.parentElement.querySelector('.kbc-learner-submenu-track-fill').getBoundingClientRect();
    const row = element.getBoundingClientRect();
    const hook = getComputedStyle(element, '::before');
    return {
      gap: Math.abs(fill.bottom - (row.top + row.height / 2)),
      color: getComputedStyle(element.parentElement.querySelector('.kbc-learner-submenu-track-fill')).backgroundColor,
      hookColor: hook.borderLeftColor,
    };
  });
  const aligned = async (active, label) => {
    await expect.poll(async () => (await geometry(active)).gap, { message: label }).toBeLessThanOrEqual(1);
    const result = await geometry(active);
    assert.equal(result.color, result.hookColor, `${label}: connected highlight has matching colors`);
  };

  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}/admin/permissions`);
    const mobile = width < 1024;
    if (mobile) await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
    const nav = page.locator(`#admin-${mobile ? 'mobile' : 'desktop'}-primary-navigation`);
    const active = nav.locator('.kbc-learner-submenu-item[data-active-path="true"]');
    await expect(active).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await aligned(active, `${width}px initial alignment`);

    // A preceding label wrapping must move the highlight end with the active row.
    const label = nav.locator('[data-nav-group="admin-group-users"] .kbc-learner-submenu-item').first().locator('a > span.flex-1');
    const original = await label.textContent();
    await label.evaluate(element => { element.textContent = 'Accounts with a longer label that wraps onto several lines in the navigation'; });
    await aligned(active, `${width}px preceding row wraps`);
    await label.evaluate((element, text) => { element.textContent = text; }, original);

    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await aligned(active, `${width}px larger text`);
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
    await aligned(active, `${width}px dark theme`);
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'light'); });

    const toggle = nav.getByRole('button', { name: 'User & Access Control', exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(active).toBeHidden();
    await toggle.click();
    await expect(active).toBeVisible();
    await aligned(active, `${width}px reopened`);
    if (screenshots) {
      await mkdir(screenshots, { recursive: true });
      await nav.screenshot({ path: resolve(screenshots, `sidebar-${width}.png`) });
    }
    await page.goto(`${origin}/curriculum/quality-demo`);
    if (mobile) await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
    const curriculumNav = page.locator(`#curriculum-${mobile ? 'mobile' : 'desktop'}-primary-navigation`);
    const quality = curriculumNav.getByRole('link', { name: 'Quality Assurance', exact: true });
    await expect(quality).toBeVisible();
    await expect(quality).toHaveAttribute('href', '/curriculum/quality-demo');
    await expect(quality).toHaveAttribute('aria-current', 'page');
    await expect(curriculumNav.getByRole('link', { name: 'Quality Checks', exact: true })).toBeVisible();
    await expect(curriculumNav.getByRole('link', { name: 'Deep Dive', exact: true })).toBeVisible();
    if (screenshots) await curriculumNav.screenshot({ path: resolve(screenshots, `quality-sidebar-${width}.png`) });
    console.log(`PASS ${width}px: connector alignment, wrapping, larger text, dark theme, collapse and reopen`);
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
} finally {
  await browser?.close();
  await server.close();
}
