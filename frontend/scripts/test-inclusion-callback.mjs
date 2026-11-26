// Run while the Inclusion Vite server is available; all auth exchanges are mocked.
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { chromium } from '@playwright/test';

const origin = process.env.INCLUSION_TEST_ORIGIN || 'http://localhost:5174';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const path of ['/login/lms/callback', '/auth/lms/callback', '/auth/lms/callback/']) {
    for (const role of ['qa', 'coach']) {
      const page = await browser.newPage();
      let exchanges = 0;
      await page.addInitScript(() => globalThis.sessionStorage.setItem('inclusion_lms_verifier', 'test-verifier'));
      await page.route('**/auth/lms/complete/', async route => {
        exchanges++;
        assert.deepEqual(route.request().postDataJSON(), { assertion: 'synthetic-assertion', verifier: 'test-verifier' });
        await route.fulfill({ json: { access: 'synthetic-access', refresh: 'synthetic-refresh', role,
          username: 'Test User', email: 'test@example.test', coach_id: role === 'coach' ? '42' : null } });
      });
      await page.route(`${origin}/`, route => route.fulfill({ contentType: 'text/html', body: '<p>Signed in</p>' }));
      const response = await page.goto(`${origin}${path}#assertion=synthetic-assertion`);
      assert.equal(response.status(), 200, `${path} must be served by the SPA`);
      await page.waitForURL(`${origin}/`);
      assert.equal(await page.evaluate(() => globalThis.localStorage.getItem('role')), role);
      assert.equal(exchanges, 1, 'StrictMode must not consume the assertion twice');
      await page.close();
      console.log(`PASS ${path}: ${role} callback exchanged once and reached dashboard`);
    }
  }
  const page = await browser.newPage();
  const response = await page.goto(`${origin}/login/lms/callback#assertion=synthetic-assertion`);
  assert.equal(response.status(), 200);
  await page.getByRole('alert').waitFor();
  assert.match(await page.getByRole('alert').innerText(), /expired/);
  assert.equal(new URL(page.url()).hash, '', 'Assertion must be removed from the address bar');
  assert.equal(await page.evaluate(() => globalThis.localStorage.getItem('access')), null);
  console.log('PASS missing browser verifier: safe retry, no login');
  await page.close();
} finally {
  await browser.close();
}
