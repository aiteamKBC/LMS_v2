import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

// Does a detail request fire for a *fresh* wizard on the cohort step (create
// flow), versus the edit flow? That isolates whether the hook is wired at all.
const out = await withPage(async (page) => {
  const detailReqs = [];
  page.on('request', (r) => {
    if (r.url().includes('/detail/')) detailReqs.push(r.url().split('/curriculum_api')[1]);
  });

  // Edit flow.
  await clickText(page, /^Edit$/);
  await page.waitForTimeout(6000);
  const afterEditOpen = [...detailReqs];
  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(8000);
  const afterEditCohort = [...detailReqs];

  return { afterEditOpen, afterEditCohort };
}, { url: '/curriculum/programmes' });

report(out);
