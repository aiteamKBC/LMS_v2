import { withPage, report } from './drive.mjs';

const out = await withPage(async (page) => {
  const text = await page.evaluate(() => document.body.innerText);
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,a[role=button],[role=tab]'))
      .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, 80),
  );
  return { textHead: text.slice(0, 2500), buttons };
}, { url: '/curriculum/programmes' });

report(out);
