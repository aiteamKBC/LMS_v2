import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

// Record every curriculum_api request during the edit interaction to see which
// step-loads actually run.
const out = await withPage(async (page) => {
  const reqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/curriculum_api/')) reqs.push(u.split('/curriculum_api')[1]);
  });

  const marks = [];
  marks.push({ mark: 'before-edit', n: reqs.length });
  await clickText(page, /^Edit$/);
  await page.waitForTimeout(7000);
  marks.push({ mark: 'after-edit-open', n: reqs.length, tail: reqs.slice(-6) });

  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(9000);
  marks.push({ mark: 'after-next-cohort', n: reqs.length, tail: reqs.slice(-6) });

  return { marks, all: reqs };
}, { url: '/curriculum/programmes' });

report(out);
