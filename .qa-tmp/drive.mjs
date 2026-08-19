// Standalone patchright driver. The browser-automation skill's --script loader
// builds a bare `d:/...` path that Node's ESM loader rejects on Windows, so this
// reuses only its patchright resolution and owns the browser itself.
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function resolveChromium() {
  const roots = [];
  for (const base of [
    join(process.env.USERPROFILE || '', '.vscode', 'extensions'),
    join(process.env.USERPROFILE || '', '.vscode-insiders', 'extensions'),
  ]) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base)
      .filter((d) => d.startsWith('danielsanmedium.dscodegpt-'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const newest = dirs[dirs.length - 1];
    if (newest) roots.push(join(base, newest, 'standalone') + '\\');
  }
  roots.push(process.cwd() + '\\');
  for (const root of roots) {
    try {
      const mod = createRequire(root)('patchright');
      const chromium = mod?.chromium ?? mod?.default?.chromium;
      if (chromium) return chromium;
    } catch {}
  }
  throw new Error('Could not resolve patchright. Checked:\n  ' + roots.join('\n  '));
}

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3001';

export async function withPage(fn, { url = '/', waitMs = 4000 } = {}) {
  const chromium = resolveChromium();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  const apiCalls = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => consoleErrors.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => failedRequests.push(`${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
  page.on('response', async (r) => {
    const u = r.url();
    if (!/_api\//.test(u)) return;
    apiCalls.push({ method: r.request().method(), url: u.replace(BASE, ''), status: r.status() });
  });

  let result, error;
  try {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => !document.body.innerText.includes('Loading workspace'),
      { timeout: 180000 },
    );
    await page.waitForTimeout(waitMs);
    result = await fn(page, { consoleErrors, failedRequests, apiCalls });
  } catch (e) {
    error = `${e.name}: ${e.message}`;
    try {
      result = { crashText: (await page.evaluate(() => document.body.innerText)).slice(0, 1500) };
    } catch {}
  }

  await browser.close();
  return { result, error, consoleErrors, failedRequests, apiCalls };
}

export function report(out) {
  console.log(JSON.stringify(out, null, 2));
}
