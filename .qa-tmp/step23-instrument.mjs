import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

// Patch fetch in the page so we can see every curriculum call INCLUDING ones
// the multi-tier cache would satisfy without touching the network, and watch
// the footer blocker over time.
const out = await withPage(async (page) => {
  await page.addInitScript(() => {
    window.__calls = [];
    const orig = window.fetch;
    window.fetch = function (...args) {
      const u = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (u && u.includes('/curriculum_api/')) window.__calls.push(u.split('/curriculum_api')[1]);
      return orig.apply(this, args);
    };
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.body.innerText.includes('Loading workspace'), { timeout: 120000 });
  await page.waitForTimeout(4000);

  await clickText(page, /^Edit$/);
  await page.waitForTimeout(6000);
  const atOpen = await page.evaluate(() => [...window.__calls]);

  await clickText(page, /Next: Cohort/);
  const timeline = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(3000);
    timeline.push(await page.evaluate(() => ({
      calls: window.__calls.length,
      detail: window.__calls.filter((c) => c.includes('/detail/')),
      blocker: document.body.innerText.includes('Loading the saved programme structure'),
    })));
  }
  return { atOpen, timeline };
}, { url: '/curriculum/programmes' });

report(out);
