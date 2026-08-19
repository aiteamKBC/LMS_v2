import { withPage, report } from './drive.mjs';
import { dump, clickText } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await clickText(page, /^Edit$/);
  await page.waitForTimeout(7000);

  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(3000);
  steps.push(await dump(page, 'edit-cohort'));

  await clickText(page, /Next: Group/);
  await page.waitForTimeout(3000);
  steps.push(await dump(page, 'edit-group'));

  await clickText(page, /Next: Modules/);
  await page.waitForTimeout(4000);
  steps.push(await dump(page, 'edit-modules'));

  await clickText(page, /Next: Components/);
  await page.waitForTimeout(4000);
  steps.push(await dump(page, 'edit-components'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
