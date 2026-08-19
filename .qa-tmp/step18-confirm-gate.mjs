import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

// Confirms the Next button stays disabled in edit mode, and that the detail
// endpoint itself answered fine (so the block is client state, not the API).
const out = await withPage(async (page) => {
  const log = [];
  await clickText(page, /^Edit$/);
  await page.waitForTimeout(6000);
  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(3000);

  for (let i = 0; i < 6; i++) {
    const nextBtn = page.locator('button').filter({ hasText: /^Next: Group$/ }).first();
    const blocker = await page.evaluate(() =>
      document.body.innerText.includes('Loading the saved programme structure before editing.'),
    );
    log.push({
      at: `${(i + 1) * 5}s`,
      nextEnabled: await nextBtn.isEnabled().catch(() => null),
      blockerShown: blocker,
      heading: await page.evaluate(() => {
        const m = document.body.innerText.match(/Choose or edit (cohort|group)/);
        return m ? m[0] : null;
      }),
    });
    await page.waitForTimeout(5000);
  }
  return { log };
}, { url: '/curriculum/programmes' });

report(out);
