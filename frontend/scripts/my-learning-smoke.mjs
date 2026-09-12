// Isolated visual check. Every API response is a fixture; no live data is read or changed.
import { chromium, expect } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const name = `my-learning-preview-${process.pid}.tsx`;
const filename = join(frontend, name);
const titles = ['Project planning and scheduling', 'Cost management and estimating', 'Risk management', 'Leadership and professional practice', 'Commercial management', 'Project controls fundamentals'];
const activities = titles.flatMap((group_name, index) => Array.from({ length: 8 }, (_, activity) => ({
  activity_id: `la:${index + 1}:${index * 10 + activity}`, group_id: index + 1,
  source_activity_id: index * 10 + activity, group_name, activity: `Lesson ${activity + 1}`,
  category: 'reading', completed: activity < [3, 8, 0, 5, 0, 2][index],
  date: null, month: 'undated', actual: 1, planned: 2, hours_mapped: true, planned_hours_mapped: true,
})));
const payload = {
  learner_name: 'Demo learner', subjects: titles.map((name, index) => ({ id: index + 1, name })), activities,
  actual_total: 42.5, planned_total: 128, covers: { 'legacy:2': '/__test/cover.svg' },
};
await writeFile(filename, `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import './src/index.css'; import './src/learner-theme.css';
import { PageContainer } from './src/components/ui/PageContainer';
import { StudentActivityPanel } from './src/pages/learner/my-learning/SubjectWorkspace';
function Preview() {
  const [data, setData] = useState(null);
  useEffect(() => { fetch('/__test/plan').then(response => response.json()).then(setData); }, []);
  return <div className="dashboard-theme" data-workspace-role="learner"><main className="workspace-main" style={{ minHeight: '100vh', background: 'var(--kbc-page-bg, #f5f7fa)' }}>
    <PageContainer><StudentActivityPanel kind="commercial" learnerId="132" data={data} loading={!data} error={null} onRetry={() => {}} /></PageContainer>
  </main></div>;
} createRoot(document.getElementById('root')!).render(<MemoryRouter><Preview /></MemoryRouter>);`);

let browser;
let releasePlan;
const planGate = new Promise(resolve => { releasePlan = resolve; });
const screenshots = [];
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const requests = [];
  let metadataReads = 0;
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).pathname.endsWith('.tsx')) console.error(`Preview module: ${response.status()} ${new URL(response.url()).pathname}`); });
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.pathname === '/__my-learning') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/${name}"></script></body></html>` });
    if (url.pathname === '/__test/plan') {
      await planGate;
      return route.fulfill({ json: payload });
    }
    if (url.pathname === '/__test/cover.svg') return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240"><rect width="600" height="240" fill="#264560"/><path d="M0 240 160 90 300 210 440 20 600 180V240" fill="#527793"/><path d="M80 240 240 130 380 220 580 100 600 240" fill="#7e9db1"/></svg>' });
    if (url.pathname.startsWith('/learner_api/subject-covers/')) {
      metadataReads += 1;
      return route.fulfill({ json: { covers: {}, current_subjects: [] } });
    }
    if (url.pathname.startsWith('/learner_api/student-activity/') && url.searchParams.has('activity_id')) return route.fulfill({ json: {
      title: 'Lesson 1', reading_html: '<p>This is a preview lesson.</p>', media: [], quiz: null,
      available: true, can_attempt: false, persistence_ready: true, completed: true,
      history: [], historical: { answers: [] },
    } });
    if (/^\/(?:[^/]*_api|api)\//.test(url.pathname)) return route.abort();
    return route.continue();
  });
  await page.goto(`${process.env.MY_LEARNING_SMOKE_URL || 'http://127.0.0.1:3000'}/__my-learning`);
  await expect(page.getByRole('status', { name: 'Loading subjects' })).toBeVisible({ timeout: 20000 }).catch(async error => {
    console.error(JSON.stringify({ errors, requests: requests.slice(-12), body: await page.locator('body').innerText() }));
    throw error;
  });
  await expect.poll(() => metadataReads).toBe(1);
  assert.equal(requests.some(path => path.endsWith('/StudentMaterial.tsx')), false, 'Media player is not downloaded for the cards');
  const loading = join(tmpdir(), 'my-learning-loading.png');
  await page.screenshot({ path: loading, animations: 'disabled' }); screenshots.push(loading);
  releasePlan();
  const region = page.getByRole('region', { name: 'Your subjects' });
  await expect(region).toBeVisible();
  for (const width of [1920, 1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No page overflow at ${width}`);
    await expect(region.locator('article')).toHaveCount(6);
    assert(await region.locator('article button').evaluateAll(cards => cards.every(card => card.scrollWidth <= card.clientWidth)), `Cards fit at ${width}`);
    const image = join(tmpdir(), `my-learning-${width}.png`);
    await page.screenshot({ path: image, fullPage: true, animations: 'disabled' }); screenshots.push(image);
  }
  const search = page.getByRole('textbox', { name: 'Search modules or activities' });
  await search.fill('Risk management');
  await expect(region.locator('article')).toHaveCount(1);
  await search.fill('no matching subject');
  await expect(page.getByText('No subjects or activities match your search.')).toBeVisible();
  await search.fill('');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: /Project planning and scheduling/ }).click();
  await page.getByRole('button', { name: 'Expand Undated activities' }).click();
  await page.getByRole('button', { name: 'Expand Undated activities, Activities awaiting a date' }).click();
  await page.getByRole('button', { name: 'Open activity', exact: true }).first().click();
  await expect(page.getByText('This is a preview lesson.')).toBeVisible();
  assert(requests.some(path => path.endsWith('/StudentMaterial.tsx')), 'Media player is downloaded when an activity opens');
  await page.getByRole('button', { name: 'All subjects' }).click();
  await expect(region.locator('article')).toHaveCount(6);
  assert.equal(metadataReads, 1, 'Metadata does not refetch as data arrives or subjects open');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, metadataReads, screenshots }));
} finally {
  releasePlan();
  await browser?.close();
  await unlink(filename);
}
