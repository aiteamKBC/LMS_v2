import { withPage, report } from './drive.mjs';
import { openWizard, clickText } from './lib-wizard.mjs';
import { fillProgramme, fillCohort, fillGroup } from './lib-flow.mjs';

const out = await withPage(async (page) => {
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
  await page.waitForTimeout(2200);
  await clickText(page, /Next: Components/);
  await page.waitForTimeout(2800);

  // What element actually carries the word "Video"?
  const cands = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const t = (el.textContent || '').trim();
      if (t === 'Video' && el.children.length === 0) {
        let p = el, chain = [];
        for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
          chain.push(`${p.tagName.toLowerCase()}${p.getAttribute('role') ? '[role=' + p.getAttribute('role') + ']' : ''}${p.className && typeof p.className === 'string' ? '.' + p.className.split(/\s+/).slice(0, 3).join('.') : ''}`);
        }
        out.push(chain.join(' < '));
      }
    }
    return out.slice(0, 5);
  });

  const selects = await page.evaluate(() =>
    Array.from(document.querySelectorAll('select')).map((s) => ({
      opts: Array.from(s.options).map((o) => o.textContent.trim()).slice(0, 12),
      value: s.value,
    })),
  );

  return { videoChain: cands, selects };
}, { url: '/curriculum/programmes' });

report(out);
