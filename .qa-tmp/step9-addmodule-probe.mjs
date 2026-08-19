import { withPage, report } from './drive.mjs';
import { openWizard, dump, clickText } from './lib-wizard.mjs';
import { fillProgramme, fillCohort, fillGroup } from './lib-flow.mjs';

const out = await withPage(async (page) => {
  const log = [];
  await openWizard(page);
  await fillProgramme(page);
  await fillCohort(page);
  await fillGroup(page);

  const btns = page.locator('button').filter({ hasText: /^Add Module$/ });
  const n = await btns.count();
  log.push({ addModuleButtons: n });

  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    log.push({
      i,
      visible: await b.isVisible().catch(() => null),
      enabled: await b.isEnabled().catch(() => null),
      box: await b.boundingBox().catch(() => null),
      html: (await b.evaluate((el) => el.outerHTML).catch(() => '')).slice(0, 300),
    });
  }

  // Click each in turn and see whether the module form appears.
  for (let i = 0; i < n; i++) {
    await btns.nth(i).click({ force: true }).catch((e) => log.push({ clickErr: `${i}: ${e.message}` }));
    await page.waitForTimeout(2000);
    const t = await page.evaluate(() => document.body.innerText);
    log.push({
      clicked: i,
      formAppeared: !t.includes('The module form appears here after a module is selected.'),
      modulesCount: (t.match(/(\d+) modules/g) || []).slice(0, 3),
      newText: t.includes('MODULE NAME') || t.includes('Module 1'),
    });
  }

  return { log, final: await dump(page, 'after-clicks') };
}, { url: '/curriculum/programmes' });

report(out);
