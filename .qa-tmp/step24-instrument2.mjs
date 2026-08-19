import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  await page.evaluate(() => {
    window.__calls = [];
    const orig = window.fetch;
    window.fetch = function (...args) {
      const u = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (u && u.includes('/curriculum_api/')) window.__calls.push(u.split('/curriculum_api')[1]);
      return orig.apply(this, args);
    };
  });

  await clickText(page, /^Edit$/);
  await page.waitForTimeout(6000);
  const atOpen = await page.evaluate(() => window.__calls.slice());

  await clickText(page, /Next: Cohort/);
  const timeline = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(3000);
    timeline.push(await page.evaluate(() => ({
      n: window.__calls.length,
      detail: window.__calls.filter((c) => c.includes('/detail/')),
      blocker: document.body.innerText.includes('Loading the saved programme structure'),
    })));
  }
  return { atOpen, timeline };
}, { url: '/curriculum/programmes' });

report(out);
