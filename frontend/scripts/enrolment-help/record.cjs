const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const catalog = require('../../src/pages/users/help/tutorials.json');
const { installMockApi } = require('./fixtures.cjs');
const base = process.env.ENROLMENT_HELP_BASE || 'http://127.0.0.1:3001';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('The recorder requires a local frontend.');
const check = process.argv.includes('--check');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const publishOnly = process.argv.find(arg => arg.startsWith('--publish='))?.slice(10);
const output = path.resolve(__dirname, '../../public/help/enrolment/v1');
const scratch = path.resolve(__dirname, '../../../../.enrolment-help-recording');
const timingsPath = path.resolve(__dirname, '../../src/pages/users/help/tutorialTimings.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function publishTake(tutorial) {
  const { starts, duration } = JSON.parse(await fs.readFile(path.join(scratch, `${tutorial.id}-take.json`), 'utf8'));
  await fs.rename(path.join(scratch, `${tutorial.id}-complete.webm`), path.join(output, `${tutorial.id}.webm`));
  const stamp = seconds => { const ms = Math.round(seconds * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; };
  const cues = tutorial.chapters.map((chapter, index) => `${index + 1}\n${stamp(starts[index])} --> ${stamp(starts[index + 1] ?? duration)}\n${chapter.title}\n${chapter.text}`);
  await fs.writeFile(path.join(output, `${tutorial.id}.vtt`), `WEBVTT\n\n${cues.join('\n\n')}\n`);
  const timings = JSON.parse(await fs.readFile(timingsPath, 'utf8'));
  timings[tutorial.id] = starts;
  await fs.writeFile(timingsPath, JSON.stringify(timings, null, 2) + '\n');
}

async function caption(page, tutorial, chapter, index) {
  await page.evaluate(({ title, text, pageTitle, number, total }) => {
    document.getElementById('recording-caption')?.remove();
    const panel = document.createElement('aside');
    panel.id = 'recording-caption';
    Object.assign(panel.style, { position: 'fixed', zIndex: '2147483647', bottom: '12px', left: '24px', right: '24px', padding: '18px 24px', borderRadius: '16px', color: 'white', background: '#241036f5', boxShadow: '0 8px 40px #0005', fontFamily: 'Arial,sans-serif', pointerEvents: 'none', border: '1px solid #a980c7' });
    const label = document.createElement('div');
    label.textContent = `${pageTitle}  •  ${number}/${total}  •  DEMONSTRATION`;
    Object.assign(label.style, { fontSize: '13px', color: '#e9ceff', letterSpacing: '1px', marginBottom: '6px' });
    const heading = document.createElement('strong');
    heading.textContent = title;
    Object.assign(heading.style, { display: 'block', fontSize: '23px', marginBottom: '6px' });
    const explanation = document.createElement('div');
    explanation.textContent = text;
    Object.assign(explanation.style, { fontSize: '21px', lineHeight: '1.45', maxWidth: '1140px' });
    panel.append(label, heading, explanation); document.body.append(panel);
  }, { ...chapter, pageTitle: tutorial.title, number: index + 1, total: tutorial.chapters.length });
}
async function point(page, locator) {
  const element = locator.first();
  await expect(element).toBeVisible();
  await element.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const rect = await element.boundingBox();
  if (!rect) throw new Error('Target has no visible box');
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: check ? 1 : 18 });
  await page.evaluate(({ x, y }) => {
    document.querySelectorAll('[data-recording-target]').forEach(el => { el.style.outline = ''; el.removeAttribute('data-recording-target'); });
    let pointer = document.getElementById('recording-pointer');
    if (!pointer) { pointer = document.createElement('div'); pointer.id = 'recording-pointer'; document.body.append(pointer); }
    Object.assign(pointer.style, { position: 'fixed', zIndex: '2147483646', width: '28px', height: '28px', border: '3px solid #f4c64b', borderRadius: '50%', boxShadow: '0 0 0 5px #f4c64b33', left: `${x - 14}px`, top: `${y - 14}px`, pointerEvents: 'none' });
  }, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  await element.evaluate(el => { el.setAttribute('data-recording-target', 'true'); el.style.outline = '3px solid #e3b633'; el.style.outlineOffset = '4px'; });
  if (!check) await sleep(550);
  return element;
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function click(page, locator) { const target = await point(page, locator); await target.click(); if (!check) await sleep(650); }

async function scene(page, tutorial, chapter) {
  const id = tutorial.id, key = chapter.id;
  if (id === 'users') {
    if (key === 'overview') return point(page, page.getByRole('button', { name: /Total users/ }));
    if (key === 'filters') { await click(page, button(page, 'Filters')); await point(page, page.getByPlaceholder('Search by name...')); await page.getByPlaceholder('Search by name...').fill('Demo'); return click(page, button(page, 'Apply filters')); }
    if (key === 'records') return point(page, button(page, 'View'));
    if (key === 'create') return click(page, button(page, 'Create user'));
    if (key === 'tools') { await click(page, button(page, 'Create user')); return click(page, button(page, 'Columns')); }
  }
  if (id === 'first-sessions') {
    if (key === 'overview') return point(page, page.getByRole('heading', { name: 'First sessions', exact: true }));
    if (key === 'filters') { await click(page, page.getByRole('combobox', { name: 'Case owner' })); return page.keyboard.press('Escape'); }
    if (key === 'details') return point(page, page.getByRole('table'));
    if (key === 'meeting') return point(page, page.getByRole('link', { name: 'Open Teams meeting for Demo Learner 1' }));
  }
  if (id === 'coach-directory') {
    if (key === 'overview') return point(page, page.getByRole('textbox', { name: 'Search coaches' }));
    if (key === 'layout') { await click(page, button(page, 'Cards')); return point(page, page.getByRole('article', { name: 'Demo Coach', exact: true })); }
    if (key === 'share') return point(page, page.getByRole('link', { name: 'Preview booking page for Demo Coach' }));
    if (key === 'edit') { await click(page, button(page, 'Add coach')); await page.getByLabel('Coach name', { exact: true }).fill('Example Training Coach'); return point(page, page.getByLabel('First session URL', { exact: true })); }
    if (key === 'remove') { await click(page, button(page, 'Cancel')); await click(page, page.getByLabel('More actions for Demo Coach', { exact: true })); return point(page, button(page, 'Remove coach')); }
  }
  if (id === 'progress-transfers') {
    if (key === 'overview') return point(page, page.getByRole('tab', { name: /^Pending/ }));
    if (key === 'filters') return point(page, page.getByRole('searchbox'));
    if (key === 'matching') { await click(page, page.getByRole('button', { name: 'Review transfer request R001' })); return point(page, page.getByRole('dialog').getByRole('heading', { name: 'Component matching', exact: true })); }
    if (key === 'approve') return point(page, button(page, 'Approve transfer'));
    if (key === 'history') { await click(page, button(page, 'Cancel')); await click(page, page.getByRole('tab', { name: /^Approved/ })); return point(page, button(page, 'Export log')); }
  }
  if (id === 'my-courses') {
    if (key === 'overview') return point(page, page.getByRole('heading', { name: 'My Courses', exact: true }));
    if (key === 'progress') return point(page, page.getByRole('progressbar'));
    if (key === 'outline') { await click(page, page.getByRole('article').locator('summary')); return point(page, page.getByText('Communication at work', { exact: true })); }
    if (key === 'continue') return point(page, page.getByRole('button', { name: /Continue learning.*Professional Development/ }));
  }
  if (id === 'enrolment-details') {
    if (key === 'overview') return point(page, page.getByRole('tab', { name: 'Overview', exact: true }));
    if (key === 'wizard') return point(page, button(page, 'Show wizard'));
    if (key === 'documents') return click(page, page.getByRole('tab', { name: 'Documents', exact: true }));
    if (key === 'skills') return click(page, page.getByRole('tab', { name: /^Skills & progress/ }));
    if (key === 'activity') return click(page, page.getByRole('tab', { name: /^Activity/ }));
  }
  if (id === 'wizard') {
    const target = `/users/1/wizard/${key}`;
    if (new URL(page.url()).pathname !== target) await page.goto(base + target, { waitUntil: 'networkidle' });
    return point(page, page.locator('main .animate-step-in').getByRole('heading').first());
  }
  if (id.endsWith('builder')) {
    if (key === 'overview') return point(page, page.getByRole('heading', { level: 1 }));
    // Each builder's native list and editor controls stay visible in the recording.
    if (key === 'steps' || key === 'sections') return point(page, page.locator('main').getByRole('button').filter({ hasText: /Personal Details|Your details|Contact details/ }));
    if (key === 'questions') return point(page, page.getByRole('button', { name: /Add (question|field)/ }).first());
    if (key === 'publish') return point(page, page.getByRole('button', { name: /Publish/ }).first());
  }
  if (id === 'training-plan') {
    if (key === 'programme') return point(page, page.getByRole('combobox').first());
    if (key === 'modules') { await click(page, button(page, 'Next')); await page.getByRole('combobox').selectOption('M1'); await click(page, button(page, 'Add')); return point(page, page.getByText('Applied workplace skills', { exact: true })); }
    if (key === 'save') { await click(page, button(page, 'Next')); return point(page, page.getByRole('button', { name: /Save/ })); }
  }
  throw new Error(`No scene for ${id}/${key}`);
}

(async () => {
  await fs.mkdir(output, { recursive: true }); await fs.mkdir(scratch, { recursive: true });
  if (publishOnly) {
    for (const tutorial of catalog.filter(item => publishOnly.split(',').includes(item.id))) await publishTake(tutorial);
    return;
  }
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    for (const tutorial of catalog.filter(item => !only || only.split(',').includes(item.id))) {
      const log = { writes: [], other: new Set(), errors: [] };
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block', ...(check ? {} : { recordVideo: { dir: scratch, size: { width: 1280, height: 800 } } }) });
      await installMockApi(context, base, log);
      const started = Date.now(), page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.setDefaultNavigationTimeout(60000);
      page.on('pageerror', error => log.errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      const record = { id: tutorial.id, passed: false };
      const starts = [];
      try {
        await page.goto(base + tutorial.path, { waitUntil: 'networkidle' });
        for (const [index, chapter] of tutorial.chapters.entries()) {
          if (tutorial.id === 'wizard' && index > 0) await page.goto(base + `/users/1/wizard/${chapter.id}`, { waitUntil: 'networkidle' });
          starts.push(Math.round((Date.now() - started) / 100) / 10);
          await caption(page, tutorial, chapter, index);
          await scene(page, tutorial, chapter);
          // Native dialogs enter the top layer; keep explanatory text inside that layer too.
          await page.evaluate(() => {
            const modal = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
            const panel = document.getElementById('recording-caption');
            if (modal?.tagName === 'DIALOG' && panel) modal.append(panel);
          });
          if (log.errors.length) throw new Error(log.errors.join('\n'));
          if (!check) {
            if (index === 0) await page.screenshot({ path: path.join(output, `${tutorial.id}.jpg`), type: 'jpeg', quality: 85 });
            await sleep(Math.max(6500, chapter.text.split(/\s+/).length * 280));
          }
        }
        record.passed = true;
        if (!check) {
          const duration = (Date.now() - started) / 1000;
          await fs.writeFile(path.join(scratch, `${tutorial.id}-take.json`), JSON.stringify({ starts, duration }));
          const video = page.video(); await context.close();
          // Publish only a closed file: Windows/Vite cannot watch an in-progress video copy.
          const completeVideo = path.join(scratch, `${tutorial.id}-complete.webm`);
          await video.saveAs(completeVideo);
          await publishTake(tutorial);
        }
      } catch (error) {
        record.passed = false;
        record.error = error.message;
        await page.screenshot({ path: path.join(scratch, `${tutorial.id}-failed.png`), fullPage: true }).catch(() => {});
        const html = await page.content().catch(() => null);
        if (html) await fs.writeFile(path.join(scratch, `${tutorial.id}-failed.html`), html);
      } finally { await context.close(); }
      record.otherRequests = [...log.other]; record.errors = log.errors; record.interceptedWrites = log.writes;
      report.push(record); console.log(JSON.stringify(record));
    }
  } finally {
    await browser.close(); await fs.writeFile(path.join(scratch, check ? 'preflight.json' : 'recording-report.json'), JSON.stringify(report, null, 2));
  }
  if (report.some(record => !record.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
