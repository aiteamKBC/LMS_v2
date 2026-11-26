// Run from frontend: node scripts/check-users-directory-tools.mjs
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import console from 'node:console';

// Render real Users menus and a coach card without app APIs, env or a backend.
const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  root, configFile: false, envDir: false, plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-directory-tools', import.meta.url)),
  optimizeDeps: { noDiscovery: true, entries: [], include: ['react', 'react-dom/client', 'react-router-dom', 'lucide-react'] },
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const html = await server.transformIndexHtml('/__directory-tools', `<!doctype html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body><div id="root"></div><script type="module">
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { FloatingMenu } from '/src/components/ui/FloatingMenu.tsx';
      import { MemoryRouter } from 'react-router-dom';
      import { EnrolmentCoachCard } from '/src/pages/admin/coach-directory/EnrolmentCoachCard.tsx';
      import { emptyLinks } from '/src/api/coachBookingDirectory.ts';
      import design from '/src/pages/users/presentation/EnrolmentWorkspace.module.css';
      const button = name => React.createElement('button', { type: 'button', key: name }, name);
      const extraMenus = [design.createMenu, design.rowMoreMenu, design.filterMultiMenu].map((panelClassName, index) =>
        React.createElement(FloatingMenu, {
          key: index, label: 'Other menu ' + index, trigger: 'Other menu ' + index,
          panelLabel: 'Other actions ' + index, panelClassName,
        }, button('Keep menu open')));
      createRoot(document.getElementById('root')).render(React.createElement(MemoryRouter, null, React.createElement('main', null,
        React.createElement('div', { style: { marginTop: 160, marginLeft: 200 } },
          React.createElement(FloatingMenu, {
            label: 'Directory tools', trigger: 'Tools', panelLabel: 'Directory tool actions',
            panelClassName: design.shellFont + ' ' + design.heroToolsMenu,
          }, ['Edit apprenticeship wizard', 'Edit eligibility form', 'Download template', 'Bulk actions'].map(button))),
        React.createElement(EnrolmentCoachCard, {
          coach: { id: 1, version: 1, name: 'Example Coach', slug: 'example-coach', links: emptyLinks() },
          busy: false, onEdit: () => {}, onCopy: () => {}, onRemove: () => {},
        }), ...extraMenus,
        React.createElement('div', { onPointerDown: event => event.stopPropagation(), style: { padding: 20 } }, button('Elsewhere')))));
    </script></body></html>`);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== base || request.method() !== 'GET'
        || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      if (url.pathname === '/__directory-tools' && !url.search) return route.fulfill({ contentType: 'text/html', body: html });
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(base + '/__directory-tools');
    const trigger = page.getByRole('button', { name: 'Directory tools' });
    await expect(trigger).toBeVisible();
    const panel = page.locator('[role="group"][aria-label="Directory tool actions"]');
    // Check computed visibility, not just [hidden]: a page rule used to override it.
    const coachTrigger = page.getByRole('button', { name: 'More actions for Example Coach' });
    const coachPanel = page.locator('[role="group"][aria-label="Actions for Example Coach"]');
    await expect(coachPanel).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
    for (const method of ['click', 'keyboard']) {
      if (method === 'click') await trigger.click();
      else { await trigger.focus(); await page.keyboard.press('ArrowDown'); }
      await expect(panel).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('button', { name: 'Edit apprenticeship wizard' })).toBeFocused();
      const anchor = await trigger.boundingBox();
      const box = await panel.boundingBox();
      expect(Math.abs(box.y - anchor.y - anchor.height - 6)).toBeLessThan(1);
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(width - 8);
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(trigger).toBeFocused();
    }
    await trigger.click();
    await page.getByRole('button', { name: 'Elsewhere' }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    for (const menuTrigger of [coachTrigger, ...await page.getByRole('button', { name: /^Other menu / }).all()]) {
      const menu = page.locator('[id="' + await menuTrigger.getAttribute('aria-controls') + '"]');
      await expect(menu).toBeHidden();
      await menuTrigger.click();
      await expect(menu).toBeVisible();
      const otherTriggers = [trigger, coachTrigger].filter(other => other !== menuTrigger);
      for (const other of otherTriggers) await expect(other).toHaveAttribute('aria-expanded', 'false');
      const menuBox = await menu.boundingBox();
      const triggerBox = await menuTrigger.boundingBox();
      expect(Math.abs(menuBox.y - triggerBox.y - triggerBox.height - 6)).toBeLessThan(1);
      await menu.getByRole('button').first().focus();
      // Non-focusable target prevents blur from hiding a broken pointer handler.
      await page.getByRole('button', { name: 'Elsewhere' }).locator('..').dispatchEvent('pointerdown', { pointerType: 'touch' });
      await expect(menu).toBeHidden();
      await expect(menuTrigger).toHaveAttribute('aria-expanded', 'false');
    }
    // Opening another menu closes the previous one in the same pointer interaction.
    await trigger.click();
    await coachTrigger.click();
    await expect(panel).toBeHidden();
    await expect(coachPanel).toBeVisible();
    await coachPanel.getByRole('button', { name: 'Copy page link', exact: true }).click();
    await expect(coachPanel).toBeHidden();
    expect(errors).toEqual([]);
    console.log(`PASS ${width}px: Users tools/create/row/filter and coach menus stay hidden, anchor on open and dismiss outside (including stopped touch events); keyboard and menu switching pass`);
    await context.close();
  }
} finally {
  await browser?.close();
  await server.close();
}
