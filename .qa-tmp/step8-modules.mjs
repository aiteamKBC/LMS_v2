import { withPage, report } from './drive.mjs';
import { openWizard, dump, clickText } from './lib-wizard.mjs';
import { fillProgramme, fillCohort, fillGroup } from './lib-flow.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);
  await fillProgramme(page);
  await fillCohort(page);
  await fillGroup(page);
  steps.push(await dump(page, 'modules-step-empty'));

  await clickText(page, /Add module/);
  await page.waitForTimeout(2500);
  steps.push(await dump(page, 'module-added'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
