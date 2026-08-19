import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

// Count detail requests across the whole edit interaction, including the
// programme step (where a prefetch for 'cohort' fires after 300ms).
const out = await withPage(async (page) => {
  const detail = [];
  page.on('request', (r) => { if (r.url().includes('/detail/')) detail.push({ t: 'req', url: r.url().split('/curriculum_api')[1] }); });
  page.on('response', (r) => { if (r.url().includes('/detail/')) detail.push({ t: 'res', status: r.status() }); });

  await clickText(page, /^Edit$/);
  await page.waitForTimeout(8000);
  const afterOpen = detail.length;
  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(8000);
  return { detail, afterOpen };
}, { url: '/curriculum/programmes' });

report(out);
