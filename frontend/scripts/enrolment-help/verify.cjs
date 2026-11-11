const { chromium, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const catalog = require('../../src/pages/users/help/tutorials.json');
const timings = require('../../src/pages/users/help/tutorialTimings.json');
const { installMockApi } = require('./fixtures.cjs');
const base = process.env.ENROLMENT_HELP_BASE || 'http://127.0.0.1:3001';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Verification requires a local frontend.');
const out = path.resolve(__dirname, '../../../../.enrolment-help-recording');
const assets = path.resolve(__dirname, '../../public/help/enrolment/v1');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const selected = catalog.filter(tutorial => !only || only.split(',').includes(tutorial.id));

(async () => {
  for (const tutorial of selected) {
    assert.equal(timings[tutorial.id]?.length, tutorial.chapters.length, `${tutorial.id}: missing recording timings`);
    assert(timings[tutorial.id].every((time, index, all) => Number.isFinite(time) && time >= 0 && (!index || time > all[index - 1])), `${tutorial.id}: non-increasing chapter times`);
    for (const extension of ['webm', 'jpg', 'vtt']) assert((await fs.stat(path.join(assets, `${tutorial.id}.${extension}`))).size > 100, `${tutorial.id}: empty ${extension}`);
    assert((await fs.readFile(path.join(assets, `${tutorial.id}.vtt`), 'utf8')).startsWith('WEBVTT\n'));
  }
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const log = { writes: [], other: new Set(), errors: [] };
      await installMockApi(context, base, log);
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', error => log.errors.push(error.message));
      for (const tutorial of selected) {
        const result = { id: tutorial.id, width, passed: false };
        try {
          await page.goto(base + tutorial.path, { waitUntil: 'networkidle' });
          const trigger = page.getByRole('button', { name: `Watch ${tutorial.title} page guide` });
          await expect(trigger).toBeVisible();
          const box = await trigger.boundingBox();
          assert(box && box.x >= 0 && box.x + box.width <= width && box.width >= 44, 'Help icon must fit the header and remain a full touch target.');
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Page overflows horizontally');
          await trigger.click();
          const dialog = page.getByRole('dialog', { name: tutorial.title, exact: true });
          await expect(dialog).toBeVisible();
          await expect(dialog.getByRole('button', { name: 'Close page guide' })).toBeFocused();
          const video = dialog.getByLabel(`${tutorial.title} screen recording`);
          await expect.poll(() => video.evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
          const media = await video.evaluate(el => ({ duration: el.duration, width: el.videoWidth, height: el.videoHeight, muted: el.muted }));
          assert(media.duration > timings[tutorial.id].at(-1) && media.width >= 1024 && media.height >= 640 && media.muted, JSON.stringify(media));
          await video.evaluate(el => { el.textTracks[0].mode = 'hidden'; });
          await expect.poll(() => video.evaluate(el => el.textTracks[0].cues?.length ?? 0)).toBe(tutorial.chapters.length);
          await video.evaluate(el => el.play());
          const before = await video.evaluate(el => el.currentTime);
          await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(before + .2);
          await video.evaluate(el => el.pause());
          const last = tutorial.chapters.length - 1;
          await dialog.getByRole('button', { name: new RegExp(tutorial.chapters[last].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
          await expect.poll(() => video.evaluate(el => el.currentTime)).toBeCloseTo(timings[tutorial.id][last], 0);
          await expect.poll(() => video.evaluate(el => el.seeking)).toBe(false);
          await expect(dialog.locator('button[aria-current="step"]')).toContainText(tutorial.chapters[last].title);
          assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Dialog overflows horizontally');
          if (tutorial.id === 'users') {
            await page.screenshot({ path: path.join(out, `guide-${width}.png`), fullPage: true });
            if (width === 1440) {
              const downloaded = page.waitForEvent('download');
              await dialog.getByRole('link', { name: 'Download video' }).click();
              const download = await downloaded;
              assert.equal(download.suggestedFilename(), 'users.webm');
              await download.saveAs(path.join(out, 'downloaded-users.webm'));
            }
            for (let i = 0; i < 7; i++) {
              await page.keyboard.press('Tab');
              assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'Focus escaped the modal');
            }
          }
          await page.keyboard.press('Escape');
          await expect(dialog).toHaveCount(0);
          await expect(trigger).toBeFocused();
          assert.equal(await page.evaluate(() => document.body.style.overflow), '');
          result.duration = Math.round(media.duration); result.passed = true;
        } catch (error) {
          result.error = error.message;
          await page.screenshot({ path: path.join(out, `guide-${tutorial.id}-${width}-failed.png`), fullPage: true }).catch(() => {});
        }
        results.push(result); console.log(JSON.stringify(result));
      }
      for (const [pathname, tutorialId, chapterId] of [
        ['/users/1/wizard/policies', 'wizard', 'policies'],
        ['/users/1?tab=documents', 'enrolment-details', 'documents'],
      ]) {
        const tutorial = catalog.find(item => item.id === tutorialId);
        const index = tutorial.chapters.findIndex(chapter => chapter.id === chapterId);
        await page.goto(base + pathname, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: `Watch ${tutorial.title} page guide` }).click();
        await expect.poll(() => page.locator('dialog video').evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
        await expect.poll(() => page.locator('dialog video').evaluate(el => el.currentTime)).toBeCloseTo(timings[tutorial.id][index], 0);
        await expect(page.locator('dialog button[aria-current="step"]')).toContainText(tutorial.chapters[index].title);
        await page.getByRole('button', { name: 'Close page guide' }).click();
      }
      // Opening help must preserve a directory search and its filtered results.
      await page.goto(base + '/users', { waitUntil: 'networkidle' });
      const search = page.getByPlaceholder('Search name, email, group or programme...');
      await search.fill('Demo Learner 2');
      await page.getByRole('button', { name: 'Watch User Management page guide' }).click();
      await page.getByRole('button', { name: 'Close page guide' }).click();
      await expect(search).toHaveValue('Demo Learner 2');
      // Browser Back closes an open guide; Forward must not reopen stale help.
      await page.goto(base + '/users/coach-directory', { waitUntil: 'networkidle' });
      if (width < 1024) await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await page.getByRole('navigation', { name: /primary navigation/ }).getByRole('link', { name: 'Users', exact: true }).click();
      await page.getByRole('button', { name: 'Watch User Management page guide' }).click();
      await page.goBack();
      await expect(page).toHaveURL(base + '/users/coach-directory');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.goForward();
      await expect(page).toHaveURL(base + '/users');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // A real failed media request must leave help readable, then recover on retry.
      let failVideo = true;
      await context.route('**/help/enrolment/v1/users.webm', route => failVideo
        ? route.fulfill({ status: 503, body: 'Synthetic video failure' }) : route.fallback());
      await page.getByRole('button', { name: 'Watch User Management page guide' }).click();
      await expect(page.getByRole('alert')).toContainText('The video could not be loaded');
      await expect(page.getByText(catalog[0].chapters[0].text, { exact: true })).toBeVisible();
      failVideo = false;
      await page.getByRole('button', { name: 'Try video again' }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect.poll(() => page.locator('dialog video').evaluate(el => el.readyState)).toBeGreaterThanOrEqual(2);
      await page.getByRole('button', { name: 'Close page guide' }).click();
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  } finally {
    await browser.close(); await fs.writeFile(path.join(out, only ? `verification-${only}.json` : 'verification.json'), JSON.stringify({ liveDataWrites: 0, results }, null, 2));
  }
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
