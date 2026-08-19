import { withPage, report } from './drive.mjs';
import { clickText } from './lib-wizard.mjs';

// Read the wizard's own footer/step state from the DOM rather than guessing,
// and check which of the three gate conditions the UI is actually showing.
const out = await withPage(async (page) => {
  await clickText(page, /^Edit$/);
  await page.waitForTimeout(7000);
  await clickText(page, /Next: Cohort/);
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      blocker: t.includes('Loading the saved programme structure before editing.'),
      cohortDbLoadingPanel: t.includes('Actual cohorts from the database are shown here when returned.'),
      noDbCohorts: t.includes('No cohorts found in the database'),
      cohortCards: (t.match(/QA Cohort QA1/g) || []).length,
      // The step chips reflect which steps the wizard considers reachable.
      chips: Array.from(document.querySelectorAll('button'))
        .filter((b) => ['Programme', 'Cohort', 'Group', 'Modules', 'Components', 'Review'].includes(b.innerText.trim()))
        .map((b) => ({ step: b.innerText.trim(), disabled: b.disabled })),
      nextLabel: Array.from(document.querySelectorAll('button'))
        .map((b) => b.innerText.trim())
        .filter((x) => x.startsWith('Next:')),
    };
  });
  return state;
}, { url: '/curriculum/programmes' });

report(out);
