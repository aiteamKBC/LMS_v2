// Synthetic learner only; intercept all API and external requests before opening the page.
import { chromium, expect } from '@playwright/test';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const name = `historical-evidence-preview-${process.pid}.tsx`;
const filename = join(frontend, name);
const assignment = { id: 'aptem:123', source: 'aptem', source_id: 123, name: 'Leadership assignment.docx', component_name: 'Strategic leadership', category: 'assignment', status: 'Accepted', date: '2026-08-10', otjh_hours: 2, ksb_codes: ['K1', 'S2'], has_file: true, has_report: true, has_note: true, replaced: false, original_has_file: true, note_preview: 'Saved reflection' };
const historical = [assignment,
  { ...assignment, id: 'aptem:124', source_id: 124, name: 'Coaching progress review', category: 'review', date: '2026-07-03', component_name: 'Progress reviews' },
  { ...assignment, id: 'aptem:125', source_id: 125, name: 'Workplace project evidence and supporting documentation for strategic change', category: 'work_product', date: '2026-06-15', component_name: 'Strategic change', status: 'Awaiting review' },
  { ...assignment, id: 'uploaded:audit-file', source: 'uploaded', source_id: 'audit-file', name: 'Additional assignment evidence.pdf', status: 'Uploaded' }];
const native = { id: 'native-1', filename: 'New evidence.pdf', contentType: 'application/pdf', sizeBytes: 2048, status: 'approved', markingStatus: '', scanResult: null, sectionRef: '', uploadedAt: '2026-09-10', trainingPlanDetails: null, canDelete: true };
await writeFile(filename, `
import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router-dom';
import './src/index.css'; import './src/learner-theme.css';
import { EvidenceBody } from './src/pages/learner/evidence/components/EvidenceBody';
createRoot(document.getElementById('root')!).render(<MemoryRouter><div className="dashboard-theme" data-workspace-role="learner"><main className="workspace-main" style={{ maxWidth: 1600, margin: 'auto', padding: 16 }}>
  <EvidenceBody learnerKind="commercial" learnerId="125" real={null} canProgress={false} showReadOnlyNotice evidenceRecords={[${JSON.stringify(native)}]} historicalRecords={${JSON.stringify(historical)}} evidenceLoading={false} evidenceError={null} reloadEvidence={() => {}} />
</main></div></MemoryRouter>);`);
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  const api = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['files.example.test', 'view.officeapps.live.com'].includes(url.hostname)) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="font:16px Arial;background:#f4f5f8;padding:25px"><article style="background:white;padding:40px;max-width:650px;margin:auto"><h1>Leadership assignment</h1><p>Synthetic document for the evidence preview check.</p><hr><h2>Assessment report</h2><p>The original learner document and assessor feedback appear in this preview.</p></article></body></html>' });
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (/^\/(?:\w+_api|api)\//.test(url.pathname)) {
      api.push(url.pathname + url.search);
      if (!url.pathname.startsWith('/learner_api/evidence/commercial/125/historical/')) return route.abort();
      const report = url.searchParams.get('part') === 'report';
      return route.fulfill({ json: url.pathname.endsWith('/open/')
        ? { url: `https://files.example.test/${report ? 'report.pdf' : 'assignment.docx'}`, download_url: 'https://files.example.test/download', name: report ? 'Assessment report.pdf' : assignment.name, content_type: report ? 'application/pdf' : null }
        : { item: assignment, documents: [{ part: 'file', name: assignment.name, content_type: null }, { part: 'report', name: 'Assessment report.pdf', content_type: 'application/pdf' }], note: '<p>The learner’s original saved reflection.</p>', feedbacks: [{ author: 'Coach', date: '2026-08-11', message: 'Original feedback retained with the assignment.' }] } });
    }
    if (url.pathname === '/__historical-evidence') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/${name}"></script></body></html>` });
    return route.continue();
  });
  await page.goto(`${process.env.EVIDENCE_SMOKE_URL || 'http://127.0.0.1:3000'}/__historical-evidence`);
  await expect(page.getByText('Showing 5 of 5 items')).toBeVisible();
  await expect(page.getByRole('button', { name: 'September 2026', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'August 2026', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button', { name: 'August 2026', exact: true }).click();
  const screenshots = [];
  for (const width of [1600, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No library overflow at ${width}`);
    const component = page.getByRole('region', { name: 'August 2026 evidence', exact: true }).getByRole('button', { name: 'Strategic leadership', exact: true });
    await component.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: `Open evidence: ${assignment.name}`, exact: true })).toHaveCount(0);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: `Open evidence: ${assignment.name}`, exact: true })).toBeVisible();
    await component.evaluate(element => element.blur());
    await page.evaluate(() => window.scrollTo(0, 0));
    const path = join(tmpdir(), `grouped-evidence-${width}.png`);
    await page.screenshot({ path, animations: 'disabled' }); screenshots.push(path);
    await page.getByRole('button', { name: `Open evidence: ${assignment.name}`, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: assignment.name });
    await expect(dialog.locator('iframe')).toHaveAttribute('src', /view.officeapps.live.com/);
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth), false, `No dialog overflow at ${width}`);
    await dialog.getByRole('button', { name: 'Assessment report', exact: true }).click();
    await expect(dialog.locator('iframe')).toHaveAttribute('src', 'https://files.example.test/report.pdf');
    const preview = join(tmpdir(), `grouped-evidence-preview-${width}.png`);
    await page.screenshot({ path: preview, animations: 'disabled' }); screenshots.push(preview);
    await dialog.getByRole('button', { name: 'Saved note', exact: true }).click();
    await expect(dialog.locator('iframe')).toHaveAttribute('sandbox', '');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Assignments only', exact: true }).click();
  await expect(page.getByText('Showing 2 of 5 items')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters', exact: true }).click();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByLabel('Source', { exact: true }).selectOption('previous');
  await page.getByLabel('Month', { exact: true }).selectOption('2026-07');
  await expect(page.getByText('Showing 1 of 5 items')).toBeVisible();
  for (const clear of await page.getByRole('button', { name: 'Clear all filters', exact: true }).all()) {
    if (await clear.isVisible()) { await clear.click(); break; }
  }
  await expect(page.getByText('Showing 5 of 5 items')).toBeVisible();
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('button', { name: 'Expand all months', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open evidence:/ })).toHaveCount(5);
  await page.getByRole('button', { name: 'Collapse all months', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Open evidence:/ })).toHaveCount(0);
  assert.deepEqual(errors, []);
  assert(api.every(path => path.startsWith('/learner_api/evidence/commercial/125/historical/')));
  console.log(JSON.stringify({ passed: true, screenshots }));
} finally {
  await browser?.close();
  await unlink(filename);
}
