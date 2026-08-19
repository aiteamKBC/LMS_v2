import { withPage, report } from './drive.mjs';
import { openWizard, STAMP } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  await openWizard(page);
  const name = page.locator('input[placeholder*="Project Controls Technician"]').first();
  const level = page.locator('input[placeholder*="L4"]').first();

  await name.fill(`QA Programme ${STAMP}`);
  await page.waitForTimeout(400);

  // fill() vs sequential typing — does the first character survive?
  await level.fill('L4');
  await page.waitForTimeout(800);
  const afterFill = await level.inputValue();

  await level.fill('');
  await page.waitForTimeout(300);
  await level.pressSequentially('L4', { delay: 120 });
  await page.waitForTimeout(800);
  const afterType = await level.inputValue();

  await level.fill('');
  await page.waitForTimeout(300);
  await level.pressSequentially('Level 4 Diploma', { delay: 60 });
  await page.waitForTimeout(800);
  const afterLong = await level.inputValue();

  return { afterFill, afterType, afterLong };
}, { url: '/curriculum/programmes' });

report(out);
