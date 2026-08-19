import { withPage, report } from './drive.mjs';
import { openWizard, dump, fillByPlaceholder, clickText, STAMP } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);

  // Step 1: programme details.
  await fillByPlaceholder(page, 'Project Controls Technician', `QA Programme ${STAMP}`);
  await fillByPlaceholder(page, 'L4', 'L4');
  await page.waitForTimeout(600);

  // Attach a KSB standard: open the "KSB Standards" source tab first.
  await clickText(page, /^KSB Standards$/);
  await page.waitForTimeout(1500);
  steps.push(await dump(page, 'after-ksb-standards-tab'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
