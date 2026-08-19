import { withPage, report } from './drive.mjs';
import { openWizard, dump, fillByPlaceholder, clickText, STAMP } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);

  await fillByPlaceholder(page, 'Project Controls Technician', `QA Programme ${STAMP}`);
  await fillByPlaceholder(page, 'L4', 'L4');
  await clickText(page, /^KSB Standards$/);
  await page.waitForTimeout(1200);
  await clickText(page, /Associate Project Manager/);
  await page.waitForTimeout(1000);
  steps.push(await dump(page, 'programme-standard-selected'));

  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(2500);
  steps.push(await dump(page, 'cohort-step'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
