/* global document, window, getComputedStyle */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';

// Synthetic dashboard, no application server, environment files or live APIs.
const output = await mkdtemp(join(tmpdir(), 'employer-pointer-focus-'));
const entry = '/__employer_focus.tsx';
const server = await createServer({
  configFile: false, envDir: false, root: process.cwd(),
  plugins: [react(), {
    name: 'employer-focus-fixture',
    resolveId: id => id === entry ? id : undefined,
    load: id => id === entry ? `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import '/src/components/feature/WorkspaceColourTheme.css';
      import '/src/index.css';
      import '/src/learner-theme.css';
      import '/src/components/feature/WorkspaceSidebarTheme.css';
      import '/src/components/feature/WorkspaceChromeTheme.css';
      import '/src/components/feature/WorkspaceEnrolmentTheme.css';
      import '/src/styles/dropdowns.css';
      import '/src/styles/search-fields.css';
      import { useEmployerPointerFocus } from '/src/pages/employer/useEmployerPointerFocus';
      import '/scripts/employer-dashboard-fixture.tsx';
      function Focus() { useEmployerPointerFocus(); return null; }
      const host = document.body.appendChild(document.createElement('div'));
      const root = createRoot(host);
      root.render(<Focus />);
      window.releaseEmployerFocus = () => root.unmount();
    ` : undefined,
  }],
  resolve: { alias: { '@': resolve(process.cwd(), 'src') } },
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
let browser;
const decoration = locator => locator.evaluate(element => {
  const style = getComputedStyle(element);
  return { outline: style.outlineStyle, shadow: style.boxShadow, border: style.borderColor };
});
try {
  await server.listen();
  browser = await chromium.launch();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const view of ['home', 'learners', 'reviews']) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width: dark ? 390 : 1440, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.routeWebSocket('**/*', ws => ws.close());
      await page.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== base || request.method() !== 'GET'
          || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
        if (url.pathname === '/__focus') return route.fulfill({ contentType: 'text/html', body: `
          <!doctype html><html${dark ? ' data-theme="dark"' : ''}><head><meta name="viewport" content="width=device-width, initial-scale=1">
          <script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script>
          </head><body><div id="root"></div><script type="module" src="${entry}"></script></body></html>` });
        return route.continue();
      });
      await page.goto(`${base}/__focus?view=${view}`);
      const search = page.getByPlaceholder('Search learners by name or email...');
      const frame = search.locator('..');
      await expect(search).toBeVisible();
      // Reproduce the real shell's shared selector context around this fixture.
      await page.locator('.dashboard-theme').evaluate(element => element.classList.add('workspace-shell'));
      const before = await decoration(frame);
      await search.click();
      expect(await decoration(frame)).toEqual({ ...before, outline: 'none', shadow: 'none' });
      expect(await decoration(search)).toMatchObject({ outline: 'none', shadow: 'none' });
      await search.pressSequentially('Alex');
      await expect(search).toHaveValue('Alex');
      expect(await decoration(frame)).toMatchObject({ outline: 'none', shadow: 'none' });
      await frame.screenshot({ path: join(output, `${view}-${dark ? 'dark-mobile' : 'light-desktop'}-pointer.png`) });

      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await expect(search).toBeFocused();
      expect((await decoration(frame)).outline).toBe('solid');
      await frame.screenshot({ path: join(output, `${view}-${dark ? 'dark-mobile' : 'light-desktop'}-keyboard.png`) });

      const clear = page.getByRole('button', { name: 'Clear filters', exact: true });
      await clear.click();
      await expect(search).toHaveValue('');
      expect(await decoration(clear)).toMatchObject({ outline: 'none', shadow: 'none' });
      if (view === 'home') {
        await page.getByRole('button', { name: /^Average attendance:/ }).click();
        const dialog = page.getByRole('dialog', { name: 'Average attendance', exact: true });
        await expect(dialog).toBeVisible();
        const close = dialog.getByRole('button', { name: 'Close', exact: true });
        await close.focus();
        expect(await decoration(close)).toMatchObject({ outline: 'none', shadow: 'none' });
        await page.keyboard.press('Tab');
        expect(await page.locator('html').getAttribute('data-employer-pointer-focus')).toBeNull();
        await close.click();
      }
      await page.evaluate(() => window.releaseEmployerFocus());
      await search.click();
      expect((await decoration(frame)).outline).toBe('solid');
      expect(await page.locator('html').getAttribute('data-employer-pointer-focus')).toBeNull();
      expect(errors).toEqual([]);
      await page.close();
      console.log(`PASS ${view}, ${dark ? 'dark mobile' : 'light desktop'}: click, typing, Tab, portal, cleanup`);
    }
  }
  console.log(`Screenshots: ${output}`);
} finally {
  await browser?.close();
  await server.close();
}
