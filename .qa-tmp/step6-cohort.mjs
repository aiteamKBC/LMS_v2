import { withPage, report } from './drive.mjs';
import { openWizard, dump, clickText, STAMP } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);

  await page.locator('input[placeholder*="Project Controls Technician"]').first().fill(`QA Programme ${STAMP}`);
  await page.waitForTimeout(400);
  await page.locator('input[placeholder*="L4"]').first().fill('L4');
  await page.waitForTimeout(400);
  await clickText(page, /^KSB Standards$/);
  await page.waitForTimeout(1200);
  await clickText(page, /Associate Project Manager/);
  await page.waitForTimeout(800);
  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(2000);

  await clickText(page, /Add cohort/);
  await page.waitForTimeout(2000);
  steps.push(await dump(page, 'cohort-added'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
