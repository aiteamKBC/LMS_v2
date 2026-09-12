// Real curriculum file bytes, rendered with the production components.
// API replies are isolated; this script cannot submit learner progress.
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = dirname(dirname(fileURLToPath(import.meta.url)));
const cache = resolve(frontend, '../.cache/legacy-progress-audit');
const cases = JSON.parse(await readFile(join(cache, 'media-browser-cases.json'), 'utf8'));
const entry = `learner-media-preview-${process.pid}.tsx`;
await writeFile(join(frontend, entry), `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {Media} from './src/pages/learner/my-learning/StudentMaterial';
import './src/index.css';
const item=JSON.parse(document.getElementById('case').textContent);
createRoot(document.getElementById('root')).render(<MemoryRouter><main style={{maxWidth:1000,margin:'20px auto'}}><Media value={item.url} kind={item.kind} title={item.name}/></main></MemoryRouter>);`);
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const results = [];
await mkdir(join(cache, 'screenshots'), { recursive: true });
try {
  for (const item of cases.filter(c => !process.env.MEDIA_CASES || process.env.MEDIA_CASES.split(',').includes(c.name))) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, locale: 'en-GB' });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      // Provider players need their own POSTs for playback. Only platform writes
      // are blocked; no learner API writes are ever forwarded.
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (!local) return route.continue();
      if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
      if (url.pathname === '/__real-media') return route.fulfill({ contentType: 'text/html', body: `<html><body><div id="root"></div><script id="case" type="application/json">${JSON.stringify(item).replaceAll('<', '\\u003c')}</script><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/${entry}"></script></body></html>` });
      if (url.pathname.startsWith('/__real-assets/')) {
        const asset = cases.find(c => c.url === url.pathname);
        if (!asset?.file) return route.abort();
        const body = await readFile(join(cache, asset.file));
        return route.fulfill({ contentType: asset.mime || 'application/octet-stream', body });
      }
      if (url.pathname === '/curriculum_api/curriculum/presentations/slides/') {
        const ext = extname(new URL(url.searchParams.get('src')).pathname);
        if (!['.pdf', '.pptx'].includes(ext)) return route.abort();
        return route.fulfill({ contentType: 'application/json', body: await readFile(join(cache, `browser-model${ext}.json`)) });
      }
      if (item.name === 'doc' && url.pathname === item.url && url.searchParams.get('preview') === '1') {
        return route.fulfill({ contentType: 'text/html', body: await readFile(join(cache, 'browser-office-preview.html')) });
      }
      if (url.pathname.startsWith('/__real-render/')) {
        const path = resolve(cache, 'browser-render', url.pathname.slice('/__real-render/'.length));
        if (!path.startsWith(resolve(cache, 'browser-render') + sep)) return route.abort();
        return route.fulfill({ contentType: 'image/png', body: await readFile(path) });
      }
      if (url.pathname.startsWith('/learner_api/media/google-drive/')) return route.fulfill({ status: 502, body: 'Google Drive returned a page instead of a media file.' });
      if (/^\/(?:[^/]*_api|api)\//.test(url.pathname)) return route.abort();
      return route.continue();
    });
    const result = { name: item.name };
    try {
      await page.goto('http://127.0.0.1:3000/__real-media', { waitUntil: 'domcontentloaded' });
      if (['pdf', 'pptx'].includes(item.name)) {
        await expect(page.getByRole('group', { name: new RegExp(`${item.name}: (?:page|slide) 1 of`) })).toBeVisible({ timeout: 30000 });
        await expect.poll(() => page.locator('img').evaluateAll(images => images.every(i => i.complete && i.naturalWidth > 0))).toBe(true);
        if (item.name === 'pptx') {
          await page.getByRole('button', { name: 'Next slide' }).click();
          await expect(page.getByText('Slide 2 of 3')).toBeVisible();
        }
        result.verified = 'rendered actual file and page controls';
      } else if (item.name === 'mp3') {
        await expect.poll(() => page.locator('audio').evaluate(e => Number.isFinite(e.duration) && e.duration > 0), { timeout: 30000 }).toBe(true);
        await page.locator('audio').evaluate(e => e.play());
        await expect.poll(() => page.locator('audio').evaluate(e => e.currentTime)).toBeGreaterThan(0);
        result.verified = 'actual audio decoded and played';
      } else if (['docx', 'xlsx'].includes(item.name)) {
        await expect(page.locator('.learner-file-preview')).toBeVisible({ timeout: 30000 });
        result.verified = 'actual document parsed and rendered';
      } else if (item.name === 'doc') {
        await expect(page.locator('iframe')).toHaveAttribute('src', /\?preview=1$/);
        await expect.poll(async () => {
          for (const frame of page.frames().slice(1)) {
            if (!frame.url().includes('officeapps.live.com')) continue;
            if ((await frame.locator('body').innerText({ timeout: 3000 }).catch(() => '')).toUpperCase().includes('PAGE 1 OF 2')) return true;
          }
          return false;
        }, { timeout: 45000 }).toBe(true);
        result.verified = 'actual legacy Word file rendered through authenticated Office preview';
      } else {
        await expect(page.locator('iframe')).toHaveCount(1, { timeout: 45000 });
        const frame = await page.locator('iframe').contentFrame();
        await expect.poll(async () => {
          const controls = [];
          for (const provider of page.frames().slice(1)) {
            controls.push(...await provider.locator('button,[role="button"]').evaluateAll(elements => elements.map(e => ({
              text: e.textContent?.slice(0, 80), label: e.getAttribute('aria-label'), visible: !!(e.getClientRects().length),
            }))).catch(() => []));
          }
          result.controls = controls;
          return controls.some(c => c.visible && /play|تشغيل/i.test(c.label || c.text || ''));
        }, { timeout: 45000 }).toBe(true);
        result.verified = 'provider frame loaded; playback requires separate confirmation';
        result.frameText = (await frame.locator('body').textContent()).slice(0, 600);
        if (item.name === 'drive') {
          // The source's accessible bottom control is covered by its initial
          // poster. The visible central Play control was inspected in the
          // screenshot; activate it inside the provider frame.
          const box = await page.locator('iframe').boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.keyboard.press('k');
          await expect.poll(async () => {
            const times = await Promise.all(page.frames().slice(1).map(f => f.locator('video').evaluateAll(videos => videos.map(v => v.currentTime)).catch(() => [])));
            return times.flat().some(t => t > 0);
          }, { timeout: 45000 }).toBe(true);
          result.verified = 'Drive fallback preview loaded and actual video playback advanced';
        }
      }
      result.passed = true;
    } catch (e) { result.passed = false; result.failure = e.message.slice(0, 400); }
    result.media = await Promise.all(page.frames().slice(1).map(f => f.locator('video,audio').evaluateAll(elements => elements.map(e => ({
      time: e.currentTime, duration: Number.isFinite(e.duration) ? e.duration : null, paused: e.paused, error: e.error?.code, ready: e.readyState,
    }))).catch(() => [])));
    result.errors = errors;
    await page.screenshot({ path: join(cache, 'screenshots', `${item.name}.png`), fullPage: true });
    results.push(result);
    console.log(JSON.stringify({ name: result.name, passed: result.passed, verified: result.verified, failure: result.failure, errors }));
    await page.close();
  }
  const prior = await readFile(join(cache, 'media-browser-results.json'), 'utf8').then(JSON.parse).catch(() => []);
  await writeFile(join(cache, 'media-browser-results.json'), JSON.stringify([
    ...prior.filter(r => !results.some(next => next.name === r.name)), ...results,
  ], null, 2));
} finally { await browser.close(); await unlink(join(frontend, entry)); }
if (results.some(r => !r.passed)) process.exitCode = 1;
