import { withPage, report } from './drive.mjs';
import { dump, clickText } from './lib-wizard.mjs';

const out = await withPage(async (page) => {
  const steps = [];
  // Open the existing programme through the card's Edit action.
  const ok = await clickText(page, /^Edit$/);
  await page.waitForTimeout(6000);
  steps.push(await dump(page, 'edit-opened'));
  return { ok, steps };
}, { url: '/curriculum/programmes' });

report(out);
