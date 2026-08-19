import { withPage, report } from './drive.mjs';

const out = await withPage(async (page) => {
  const openBtn = page.getByRole('button', { name: /Create Programme Structure/i }).first();
  if (!(await openBtn.count())) return { error: 'no create button' };
  await openBtn.click();
  await page.waitForTimeout(3000);

  const text = await page.evaluate(() => document.body.innerText);
  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,select,textarea')).map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      name: el.getAttribute('name'),
      id: el.id,
      placeholder: el.getAttribute('placeholder'),
      label: el.getAttribute('aria-label'),
      value: 'value' in el ? String(el.value).slice(0, 60) : undefined,
    })),
  );
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((el, i) => ({
      i,
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      disabled: el.disabled,
    })).filter((b) => b.text),
  );
  return { text: text.slice(0, 4000), fields, buttons };
}, { url: '/curriculum/programmes' });

report(out);
