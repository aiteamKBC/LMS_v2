import { withPage, report } from './drive.mjs';
import { openWizard, dump } from './lib-wizard.mjs';
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
  steps.push(await dump(page, 'create-new-module-selected'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
