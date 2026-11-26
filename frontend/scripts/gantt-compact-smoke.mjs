// Isolated component preview: synthetic data; all API requests are blocked.
import { chromium, expect } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const name = `gantt-compact-preview-${process.pid}.tsx`;
const filename = join(frontend, name);
const names = ['Portfolio Management', 'Managing Successful Programmes', 'Stakeholders, Leadership & Capability', 'Control Frameworks & Value Cycles', 'Risk Management Fundamentals', 'Risk Analysis & Techniques'];
const subjects = Array.from({ length: 36 }, (_, index) => ({
  id: `current:M${index}`, title: `${names[index % 6]} — Module ${index + 1}`, source: 'current',
  activities: Array.from({ length: 5 }, (_, i) => ({ id: `${index}-${i}`, title: `Learning activity ${i + 1}`, category: 'reading', position: i, completed: i < index % 6, schedule: {} })),
}));
const data = { months: { '2026-09': { topics: ['Risk Management Fundamentals'], planned: 15 }, '2026-10': { topics: ['Risk Process Implementation'], planned: 18 } }, actual: [], actualAvailable: true,
  modules: subjects.map((subject, index) => ({ id: `M${index}`, title: subject.title, description: 'Explore the core ideas and apply them to your own workplace. Your learning activities and live sessions are available in this module.', tutor_name: 'Taylor Morgan', coach_name: 'Sam Taylor',
    start_date: index > 33 ? null : `2026-${String(index === 32 ? 9 : index % 12 + 1).padStart(2, '0')}-01`, end_date: index > 33 ? null : `2026-${String(index === 32 ? 10 : index % 12 + 1).padStart(2, '0')}-28` })),
  moduleLinks: {}, sessions: [], coach: { name: 'Sam Taylor', bookingUrl: null }, contractStatus: 'ready', generatedAt: '',
  reviews: Array.from({ length: 12 }, (_, index) => ({ id: String(index), eventKey: `review:${index}`, title: `Progress review ${index + 1}`, source: 'progress-review', status: 'scheduled', date: `2026-${String(index + 1).padStart(2, '0')}-08` })),
};
await writeFile(filename, `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import './src/index.css'; import './src/learner-theme.css';
import { ModuleTimeline } from './src/pages/learner/training-plan-timeline/ModuleTimeline';
import { buildPlanModules } from './src/pages/learner/training-plan-timeline/model';
const data = ${JSON.stringify(data)};
const modules = buildPlanModules(${JSON.stringify(subjects)}, data);
function Preview() {
  const [month, setMonth] = useState('2026-09'); const [id, setId] = useState('');
  return <MemoryRouter><div className="dashboard-theme" data-workspace-role="learner"><main className="workspace-main" style={{ maxWidth: 1450, margin: 'auto', padding: 16 }}>
    <button id="outside">Outside chart</button>
    <ModuleTimeline data={data} modules={modules} kind="commercial" learnerId="125" today="2026-09-12" selectedMonth={month} selectedId={id} onMonthChange={setMonth} onModuleSelect={module => setId(module.id)} />
  </main></div></MemoryRouter>;
} createRoot(document.getElementById('root')!).render(<Preview />);`);
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => {
  const url = new URL(route.request().url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || /_api\/|\/api\//.test(url.pathname)) return route.abort();
  if (url.pathname === '/__gantt-compact') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/${name}"></script></body></html>` });
  return route.continue();
});
const screenshots = [];
async function screenshot(label) {
  const path = join(tmpdir(), `gantt-compact-${label}.png`);
  await page.screenshot({ path, animations: 'disabled' }); screenshots.push(path);
}
try {
  await page.goto(`${process.env.TIMELINE_SMOKE_URL || 'http://127.0.0.1:3000'}/__gantt-compact`);
  await page.getByRole('heading', { name: 'Module timeline', exact: true }).waitFor();
  assert.equal(await page.getByRole('progressbar').count(), 36);
  assert.equal(await page.locator('[data-module-id]').first().evaluate(node => node.getBoundingClientRect().height), 52);
  const plot = page.getByLabel('Scroll module timeline');
  const headerTop = await page.locator('[data-timeline-header]').evaluate(node => node.getBoundingClientRect().top);
  const review = page.getByText('Coaching reviews', { exact: true });
  const reviewTop = (await review.boundingBox()).y;
  await plot.evaluate(node => { node.scrollTop = 500; node.scrollLeft = 120; });
  assert(Math.abs(await page.locator('[data-timeline-header]').evaluate(node => node.getBoundingClientRect().top) - headerTop) < 2);
  assert(Math.abs((await review.boundingBox()).y - reviewTop) < 2);
  await plot.evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
  await screenshot('desktop');
  await page.getByRole('button', { name: /Show .*Module 33 overview/ }).click();
  await page.getByRole('complementary', { name: 'Timeline module details' }).waitFor();
  assert.match(await page.getByRole('link', { name: 'Open module', exact: true }).getAttribute('href'), /subject=current%3AM32/);
  await screenshot('details');
  await plot.evaluate(node => { node.scrollTop = 500; });
  await page.getByRole('button', { name: 'Close module details' }).click();
  assert.equal(await plot.evaluate(node => node.scrollTop), 500, 'Closing details preserves the position reached while inspecting');
  await plot.evaluate(node => { node.scrollTop = 400; node.scrollLeft = 0; });
  await page.getByRole('button', { name: 'Full screen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Programme timeline' });
  await expect(dialog).toBeVisible();
  assert.equal(await page.getByRole('progressbar').count(), 36);
  assert.equal(await page.getByLabel('Scroll module timeline').evaluate(node => node.scrollTop), 400);
  await screenshot('fullscreen');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  assert.equal(await plot.evaluate(node => node.scrollTop), 400);
  await page.getByRole('button', { name: 'Current module', exact: true }).click();
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.getByRole('button', { name: 'Close module details' }).click();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No page overflow at ${width}`);
    await screenshot(String(width));
    if (width <= 390) {
      await page.getByRole('button', { name: 'Current module', exact: true }).click();
      await expect(page.getByRole('complementary')).toBeVisible();
      await screenshot(`${width}-details`);
      await page.getByRole('button', { name: 'Close module details' }).click();
      await expect(plot).toBeVisible();
      const currentRow = page.locator('[data-module-id="current:M32"]');
      const rowBox = await currentRow.boundingBox();
      const plotBox = await plot.boundingBox();
      assert(rowBox.y >= plotBox.y + 64 && rowBox.y + rowBox.height <= plotBox.y + plotBox.height - 50, 'Closing current-module details reveals its row on mobile');
      assert(await plot.evaluate(node => node.scrollLeft) > 0, 'Current month is brought into view on mobile');
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, screenshots }));
} finally { await browser.close(); await unlink(filename); }
