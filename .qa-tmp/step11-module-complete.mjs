import { withPage, report } from './drive.mjs';
import { openWizard, dump, clickText } from './lib-wizard.mjs';
import { fillProgramme, fillCohort, fillGroup } from './lib-flow.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);
  await fillProgramme(page);
  await fillCohort(page);
  await fillGroup(page);

  await page.locator('button').filter({ hasText: /^Add Module$/ }).first().click();
  await page.waitForTimeout(2200);
  await page.locator('button').filter({ hasText: /Create New Module/ }).first().click();
  await page.waitForTimeout(1500);

  await page.locator('input[placeholder*="Contract Administration"]').first().fill('QA Module Alpha');
  await page.waitForTimeout(700);
  await page.locator('input[type=number]').first().fill('4');
  await page.waitForTimeout(2500);
  steps.push(await dump(page, 'module-filled'));

  const advanced = await clickText(page, /Next: Components/);
  await page.waitForTimeout(3000);
  steps.push(await dump(page, 'components-step'));

  return { advanced, steps };
}, { url: '/curriculum/programmes' });

report(out);
