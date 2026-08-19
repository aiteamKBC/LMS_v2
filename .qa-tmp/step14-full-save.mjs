import { withPage, report } from './drive.mjs';
import { openWizard, dump, clickText } from './lib-wizard.mjs';
import { fillProgramme, fillCohort, fillGroup } from './lib-flow.mjs';

const PROG = process.env.QA_PROG || 'QA Programme QA1';

const out = await withPage(async (page) => {
  const steps = [];
  await openWizard(page);
  await fillProgramme(page, PROG);
  await fillCohort(page);
  await fillGroup(page);

  await page.locator('button').filter({ hasText: /^Add Module$/ }).first().click();
  await page.waitForTimeout(2200);
  await page.locator('button').filter({ hasText: /Create New Module/ }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('input[placeholder*="Contract Administration"]').first().fill('QA Module Alpha');
  await page.waitForTimeout(700);
  await page.locator('input[type=number]').first().fill('4');
  await page.waitForTimeout(2200);
  await clickText(page, /Next: Components/);
  await page.waitForTimeout(2800);

  // Add three components of different types.
  for (const type of ['video', 'quiz', 'assignment']) {
    await page.locator('select').first().selectOption(type).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('button').filter({ hasText: /^Add Component$/ }).first().click();
    await page.waitForTimeout(2000);
  }
  steps.push(await dump(page, 'components-added'));

  await clickText(page, /Next: Review/);
  await page.waitForTimeout(3000);
  steps.push(await dump(page, 'review-step'));

  return { steps };
}, { url: '/curriculum/programmes' });

report(out);
