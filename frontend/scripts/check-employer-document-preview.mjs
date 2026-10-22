/* global document, innerWidth */
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { jsPDF } from 'jspdf';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';

// No environment file, backend proxy or live API. All documents are synthetic.
const root = process.cwd();
const output = await mkdtemp(join(tmpdir(), 'employer-document-preview-'));
const server = await createServer({ configFile: false, envDir: false, root, plugins: [react()],
  resolve: { alias: { '@': resolve(root, 'src') } }, server: { host: '127.0.0.1', port: 4321, strictPort: true, hmr: false } });
const definition = {
  manualOverride: null,
  instance: { id: 'ri-1', reviewTemplateId: 'template-1', learnerId: 101, programmeId: 'programme-1', occurrenceNumber: 1,
    targetDate: '2026-10-21', status: 'draft', startedAt: null, completedAt: null },
  template: { id: 'template-1', name: 'Progress review', signatures: { advisor: true, participant: true, employer: true, referrer: false },
    visibleTo: { advisor: true, participant: true, employer: true, referrer: false }, recurrence: { interval: 12, unit: 'weeks' }, notifications: {}, allowEditingPriorDays: 0 },
  sections: [{ id: 'discussion', title: 'Discussion', enabled: true, displayOrder: 0, estimatedMinutes: 0, fields: [
    { id: 'feedback', title: 'Employer feedback', fieldType: 'text', required: false, displayOrder: 0, configuration: { respondentRoles: ['employer'] },
      answer: 'Saved example feedback for read-only preview.' },
  ] }],
  signatures: { advisor: { required: true, signed: false }, participant: { required: true, signed: false }, employer: { required: true, signed: false }, referrer: { required: false, signed: false } },
  pdf: { available: false, reason: 'The final PDF is available after completion and all required signatures.' },
};
const pdf = new jsPDF();
pdf.text('Example signed progress review', 20, 30);
pdf.text('Synthetic document for preview validation only.', 20, 45);
const pdfBytes = Buffer.from(pdf.output('arraybuffer'));
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const base = 'http://127.0.0.1:4321';
  for (const width of [1440, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, acceptDownloads: true });
    const errors = [], downloads = [];
    let fail = false;
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error: ' + error.message); });
    page.on('download', download => downloads.push(download));
    await page.routeWebSocket('**/*', ws => ws.close());
    await page.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base || request.method() !== 'GET') return route.abort();
      if (url.pathname === '/__preview') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/employer-document-preview-fixture.tsx"></script></body></html>` });
      if (/\/employer-portal\/9\/learner\/commercial\/101\/events\/[^/]+\/review\/$/.test(url.pathname)) {
        if (fail) return route.fulfill({ status: 503, json: { error: 'Example temporary read failure' } });
        return route.fulfill({ json: { ...definition, pdf: url.pathname.includes('signed-1') ? { available: true, reason: '' } : definition.pdf } });
      }
      if (url.pathname.endsWith('/events/signed-1/review/pdf/')) return route.fulfill({ contentType: 'application/pdf', body: pdfBytes,
        headers: { 'Content-Disposition': 'attachment; filename="Example-review.pdf"' } });
      if (/^\/(?:\w+_api|api)\//.test(url.pathname) || ['fetch', 'xhr'].includes(request.resourceType())) return route.abort();
      return route.continue();
    });
    await page.goto(base + '/__preview');
    const draft = page.getByRole('button', { name: 'Draft progress review', exact: true });
    await draft.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('The final PDF is available after completion and all required signatures.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Sign|Save my answers/ })).toHaveCount(0);
    await expect(dialog.getByRole('link', { name: 'Download', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('textbox')).toHaveValue('Saved example feedback for read-only preview.');
    await expect(dialog.getByRole('textbox')).toBeDisabled();
    await page.screenshot({ path: join(output, `${width}-draft.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(draft).toBeFocused();
    await page.getByRole('button', { name: 'Signed progress review', exact: true }).click();
    const downloadLink = page.getByRole('link', { name: 'Download', exact: true });
    await expect(downloadLink).toBeVisible();
    await expect(page.getByRole('region', { name: 'Signed progress review preview' })).toBeVisible();
    await expect(page.getByLabel('Report page 1', { exact: true })).toBeVisible();
    expect(downloads).toHaveLength(0);
    const layout = await dialog.evaluate(element => ({ width: element.scrollWidth, visible: element.clientWidth,
      page: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(layout.width).toBeLessThanOrEqual(layout.visible + 1);
    expect(layout.page).toBeLessThanOrEqual(layout.viewport + 1);
    await page.screenshot({ path: join(output, `${width}-pdf.png`) });
    const downloadPromise = page.waitForEvent('download');
    await downloadLink.click();
    const downloaded = await downloadPromise;
    expect(downloaded.suggestedFilename()).toBe('Example-review.pdf');
    expect(await readFile(await downloaded.path())).toEqual(pdfBytes);
    await page.getByRole('button', { name: 'Close document preview' }).click();
    if (width === 1440) {
      fail = true;
      await draft.click();
      await expect(page.getByRole('alert')).toContainText('Example temporary read failure');
      fail = false;
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(dialog.getByRole('textbox')).toHaveValue('Saved example feedback for read-only preview.');
      await page.keyboard.press('Escape');
    }
    expect(errors).toEqual([]);
    await page.close();
    console.log('PASS preview/read-only/Escape/download viewport=' + width);
  }
  console.log('Screenshots: ' + output);
} finally {
  await browser?.close();
  await server.close();
}
