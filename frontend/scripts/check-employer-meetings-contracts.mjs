/* global document, window */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';

// Standalone synthetic UI: no env files, proxy, backend, database, or external API.
const root = process.cwd();
const output = process.argv[2] ? resolve(process.argv[2]) : await mkdtemp(join(tmpdir(), 'employer-contracts-'));
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, envDir: false, root, plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 0, hmr: false } });
let browser;
const results = [];
try {
  await server.listen();
  browser = await chromium.launch();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  for (const width of [1440, 390, 320]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      const contractRequests = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.routeWebSocket('**/*', ws => ws.close());
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== base) return route.abort();
        if (url.pathname === '/learner_api/employer-portal/8/meetings/') return route.fulfill({ json: {
          status: 'ready', meetings: [{ id: 'live:1', title: 'Teams progress discussion',
            startsAt: '2026-12-07T10:00:00Z', endsAt: '2026-12-07T11:00:00Z',
            scheduledDate: '2026-12-07', scheduledTime: '10:00', endTime: '11:00',
            coachName: 'Example Coach', joinUrl: 'https://teams.microsoft.com/synthetic-live',
            learners: [{ id: '11', kind: 'apprenticeship', name: 'Alex Learner' }] }],
        } });
        if (url.pathname.startsWith('/learner_api/')) {
          if (url.pathname.endsWith('/contracts/')) contractRequests.push(url.pathname);
          return route.abort();
        }
        if (url.pathname === '/__meetings_contracts') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/scripts/employer-meetings-contracts-fixture.tsx"></script></body></html>' });
        return route.continue();
      });
      await page.goto(`${base}/__meetings_contracts?theme=${theme}`);
      const meetings = page.getByRole('region', { name: 'Meetings to attend (3)' });
      try {
        await expect(meetings).toBeVisible();
      } catch (error) {
        console.error(JSON.stringify({ errors, rendered: await page.locator('body').innerText() }));
        throw error;
      }
      await expect(page.getByRole('region', { name: /^Contracts/ })).toHaveCount(0);
      await expect(meetings.getByText('Unbooked imported plan')).toHaveCount(0);
      await expect(meetings.getByRole('link', { name: /^Join / })).toHaveCount(3);
      await expect(meetings.getByRole('link', { name: 'Join Teams: Teams progress discussion' })).toBeVisible();
      expect(contractRequests).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      expect(overflow).toBe(false);
      expect(errors).toEqual([]);
      await page.screenshot({ path: join(output, `meetings-contracts-${width}-${theme}.png`), fullPage: true });
      results.push({ width, theme, overflow, errors, meetings: 3, contracts: 0, contractRequests });
      await page.close();
    }
  }
  await writeFile(join(output, 'validation.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ output, results }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
