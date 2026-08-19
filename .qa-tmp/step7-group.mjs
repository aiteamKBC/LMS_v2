import { withPage, report } from './drive.mjs';
import { openWizard, dump, clickText } from './lib-wizard.mjs';
import { fillProgramme, fillCohort } from './lib-flow.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);
  await fillProgramme(page);
  await fillCohort(page);
  steps.push(await dump(page, 'group-step-empty'));

  await clickText(page, /Add group/);
  await page.waitForTimeout(2000);
  steps.push(await dump(page, 'group-added'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
