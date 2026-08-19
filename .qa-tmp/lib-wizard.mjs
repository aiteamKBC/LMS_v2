// Shared helpers for driving the Add Curriculum Structure wizard.

export async function dump(page, label) {
  const text = await page.evaluate(() => document.body.innerText);
  const fields = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input,select,textarea')).map((el, i) => ({
      i,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      placeholder: el.getAttribute('placeholder'),
      label: el.getAttribute('aria-label'),
      value: 'value' in el ? String(el.value).slice(0, 40) : undefined,
    })),
  );
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((el, i) => ({
      i,
      text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 70),
      disabled: el.disabled,
    })).filter((b) => b.text),
  );
  return { label, text: text.slice(0, 6000), fields, buttons };
}

export async function openWizard(page) {
  await page.getByRole('button', { name: /Create Programme Structure/i }).first().click();
  await page.waitForTimeout(2500);
}

// Click a button by exact-ish visible text, preferring enabled ones.
export async function clickText(page, re, { timeout = 15000 } = {}) {
  const btn = page.locator('button').filter({ hasText: re });
  const n = await btn.count();
  for (let i = 0; i < n; i++) {
    const b = btn.nth(i);
    if (await b.isEnabled().catch(() => false) && await b.isVisible().catch(() => false)) {
      await b.click({ timeout });
      return true;
    }
  }
  return false;
}

export async function fillByPlaceholder(page, ph, value) {
  const el = page.locator(`input[placeholder*="${ph}"],textarea[placeholder*="${ph}"]`).first();
  if (!(await el.count())) return false;
  await el.fill(value);
  return true;
}

export const STAMP = process.env.QA_STAMP || 'QA1';
