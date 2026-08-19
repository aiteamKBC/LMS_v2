export default async function run(page, ui) {
  // Lazy chunk compiles on first request; wait for the fallback to go away.
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading workspace'),
      { timeout: 120000 },
    );
  } catch {
    return { stuck: true, text: await page.evaluate(() => document.body.innerText.slice(0, 500)) };
  }
  await page.waitForTimeout(3000);
  const snap = await ui.snapshot();
  const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  return { snap, text };
}
