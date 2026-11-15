// Real browser layout regression for the marking prompt panel.
// Run: node scripts/marking-instructions-browser-check.mjs
// Bundles only the component and a synthetic fixture in memory. No app server,
// environment files, database, authentication, API calls or external services.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureId = resolve(root, 'scripts/marking-instructions-fixture.js').replaceAll('\\', '/');
const result = await build({
  root, configFile: false, envFile: false, logLevel: 'error',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [react(), {
    name: 'marking-instructions-fixture',
    enforce: 'pre',
    resolveId(id) { if (id.replaceAll('\\', '/').endsWith('/marking-instructions-fixture.js')) return '\0' + fixtureId; },
    load(id) {
      if (id !== '\0' + fixtureId) return;
      return `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { MarkingInstructionsPanel } from '${root.replaceAll('\\', '/')}/src/pages/coach/marking-review/MarkingInstructionsPanel.tsx';
        import styles from '${root.replaceAll('\\', '/')}/src/pages/coach/marking-review/markingReview.module.css';
        import '${root.replaceAll('\\', '/')}/src/index.css';
        const e = React.createElement;
        function Fixture() {
          const [prompt, setPrompt] = useState('Assess the submitted evidence against the programme criteria. Explain strengths and next steps.\\n'.repeat(180));
          const [file, setFile] = useState(null);
          return e('div', {className:'workspace-main', style:{height:'70vh',overflow:'auto',transform:'translateZ(0)'}},
            e('button', null, 'Outside control'),
            e(MarkingInstructionsPanel, {edited:true, guidanceAttached:!!file},
              e('p', null, 'These assignment marking instructions apply to the next draft only.'),
              e('textarea', {'aria-label':'AI marking instructions', rows:8, value:prompt,onChange:event=>setPrompt(event.target.value)}),
              e('label', {className:styles.promptUpload},
                e('span', null, 'Upload marking guidance'),
                e('input', {'aria-label':'Upload marking guidance', type:'file',onChange:event=>setFile(event.target.files[0])}),
                e('small', null, 'PDF or Word (.docx), up to 5 MB. Used for this draft only.')),
              file && e('div', {className:styles.promptFile}, e('span', null,file.name),e('button',{onClick:()=>setFile(null)},'Remove')),
              e('div', {className:styles.promptMeta}, e('span', null,'Synthetic marking guidance'),e('button', {onClick:()=>setPrompt('Original criteria')},'Reset to default'))),
            e('div', {style:{height:'2000px'}}, 'Background page content'));
        }
        createRoot(document.getElementById('root')).render(e(Fixture));
      `;
    },
  }],
  build: { write: false, minify: false, lib: { entry: fixtureId, name: 'PromptPanelCheck', formats: ['iife'] } },
});
const output = (Array.isArray(result) ? result[0] : result).output;
const browser = await chromium.launch({ headless: true });
const screenshots = await mkdtemp(join(tmpdir(), 'lms-marking-expand-'));
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<html><body><div id="root"></div></body></html>');
  for (const asset of output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css'))) {
    await page.evaluate(css => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    }, String(asset.source).replace(/@import\s+url\([^;]+;/g, ''));
  }
  await page.evaluate(code => { (0, eval)(code); }, output.find(item => item.type === 'chunk').code);
  await page.getByRole('button', { name: 'AI marking instructions', exact: false }).first().waitFor();
  await page.getByRole('button', { name: /^AI marking instructions/ }).click();
  const field = page.getByRole('textbox', { name: 'AI marking instructions' });
  const initial = await field.inputValue();
  const inlineHeight = (await field.boundingBox()).height;
  await page.getByLabel('Upload marking guidance').setInputFiles({ name: 'synthetic-guide.txt', mimeType: 'text/plain', buffer: Buffer.from('Use synthetic criteria.') });
  await page.getByRole('button', { name: 'Expand AI marking instructions' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await field.inputValue(), initial);
  assert.equal(await dialog.getByText('synthetic-guide.txt', { exact: true }).count(), 1);

  const sizes = [];
  for (const viewport of [{width:1440,height:900}, {width:2560,height:1352}, {width:390,height:844}, {width:844,height:390}]) {
    await page.setViewportSize(viewport);
    const geometry = await dialog.evaluate(panel => {
      const t = panel.querySelector('textarea');
      const upload = panel.querySelector('input[type=file]').closest('label');
      const meta = panel.querySelector('input[type=file]').closest('label').nextElementSibling.nextElementSibling;
      const box = el => { const r = el.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right}; };
      return {panel:box(panel),textarea:box(t),upload:box(upload),footer:box(meta),scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,
        textareaResize:getComputedStyle(t).resize,bodyOverflow:document.body.style.overflow};
    });
    assert.ok(geometry.panel.top >= 0 && geometry.panel.bottom <= viewport.height, 'panel fits viewport');
    assert.ok(geometry.panel.left >= 0 && geometry.panel.right <= viewport.width, 'no horizontal overflow');
    assert.ok(geometry.textarea.height > viewport.height * (viewport.height < 500 ? .25 : .55), 'textarea fills the available height');
    assert.ok(geometry.panel.bottom - geometry.footer.bottom < 30, 'no blank area below the controls');
    assert.ok(geometry.upload.top - geometry.textarea.bottom < 20, 'no blank area after the editor');
    assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1, 'dialog does not scroll');
    assert.equal(geometry.textareaResize, 'none');
    assert.equal(geometry.bodyOverflow, 'hidden');
    sizes.push({viewport,textareaHeight:Math.round(geometry.textarea.height)});
    await page.screenshot({ path: join(screenshots, `${viewport.width}x${viewport.height}.png`) });
  }
  await page.setViewportSize({width:1440,height:900});
  assert.ok((await field.boundingBox()).height > inlineHeight * 2, 'Expand materially enlarges the text field');
  await field.hover();
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => document.querySelector('[role=dialog] textarea').scrollTop > 0);
  assert.equal(await page.locator('.workspace-main').evaluate(el => el.scrollTop), 0);
  await page.getByRole('button', { name: 'Collapse AI marking instructions' }).focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.getByRole('button', {name:'Reset to default'}).evaluate(el=>el===document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', {name:'Collapse AI marking instructions'}).evaluate(el=>el===document.activeElement), true);
  await field.fill('Updated synthetic marking criteria.');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await field.inputValue(), 'Updated synthetic marking criteria.');
  assert.equal(await page.getByText('synthetic-guide.txt', {exact:true}).count(), 1);
  assert.equal(await page.evaluate(() => document.body.style.overflow), '');
  assert.equal(await page.getByRole('button', {name:'Expand AI marking instructions'}).evaluate(el=>el===document.activeElement), true);
  await page.getByRole('button', {name:'Expand AI marking instructions'}).click();
  await page.getByRole('button', {name:'Collapse AI marking instructions'}).click();
  assert.equal(await field.inputValue(), 'Updated synthetic marking criteria.');
  await page.getByRole('button', {name:'Expand AI marking instructions'}).click();
  await page.mouse.click(2, 2);
  assert.equal(await dialog.count(), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({result:'PASS',inlineHeight,sizes,screenshots,checks:['viewport layout','inner scroll only','keyboard focus','Escape/Collapse/backdrop','edits and attachment preserved'],backend:'none; all network blocked'}));
} finally {
  await browser.close();
}
